#!/usr/bin/env node

/**
 * Snip MCP Server — stdio transport.
 *
 * This is a thin adapter between the MCP protocol (JSON-RPC 2.0 over stdio)
 * and the running Snip Electron app (via Unix domain socket).
 *
 * Usage:
 *   node src/mcp/server.js
 *
 * MCP client config (Claude Desktop, etc.):
 *   {
 *     "mcpServers": {
 *       "snip": {
 *         "command": "node",
 *         "args": ["/path/to/snip/src/mcp/server.js"]
 *       }
 *     }
 *   }
 */

const net = require('net');
const path = require('path');
const os = require('os');
const readline = require('readline');

const SOCKET_PATH = path.join(
  os.homedir(), 'Library', 'Application Support', 'snip', 'snip.sock'
);

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'snip';
const SERVER_VERSION = '1.0.0';

// ── MCP Tool Definitions ──

const TOOLS = [
  {
    name: 'capture_screen',
    description: 'Take a screenshot of the current screen. Returns the image as a base64 data URL with dimensions.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'search_screenshots',
    description: 'Search saved screenshots using natural language. Uses semantic embeddings for relevance ranking.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Natural language search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_screenshots',
    description: 'List all indexed screenshots with their metadata (category, name, description, tags, path).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'get_screenshot',
    description: 'Get a screenshot image and metadata by file path. Returns base64 image data and index entry.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Absolute path to the screenshot file' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'transcribe_screenshot',
    description: 'Extract text from a screenshot using OCR (macOS Vision framework). Provide a file path to a screenshot.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Absolute path to the screenshot file' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'organize_screenshot',
    description: 'Trigger AI categorization for a screenshot. The AI will analyze the image and assign a category, name, description, and tags.',
    inputSchema: {
      type: 'object',
      properties: {
        filepath: { type: 'string', description: 'Absolute path to the screenshot file' }
      },
      required: ['filepath']
    }
  },
  {
    name: 'get_categories',
    description: 'List all screenshot categories (both default and custom).',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  }
];

// ── Socket Connection ──

let snipConn = null;
let pendingRequests = {};
let requestCounter = 0;

function connectToSnip() {
  return new Promise(function (resolve, reject) {
    var conn = net.createConnection(SOCKET_PATH);
    var buffer = '';

    conn.on('connect', function () {
      snipConn = conn;
      resolve(conn);
    });

    conn.on('data', function (chunk) {
      buffer += chunk.toString();
      var newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        var line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;

        try {
          var response = JSON.parse(line);
          var pending = pendingRequests[response.id];
          if (pending) {
            delete pendingRequests[response.id];
            if (response.error) {
              pending.reject(new Error(response.error));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {}
      }
    });

    conn.on('error', function (err) {
      snipConn = null;
      reject(new Error('Cannot connect to Snip app. Is it running? (' + err.message + ')'));
    });

    conn.on('close', function () {
      snipConn = null;
      // Reject all pending requests
      Object.keys(pendingRequests).forEach(function (id) {
        pendingRequests[id].reject(new Error('Connection to Snip closed'));
        delete pendingRequests[id];
      });
    });
  });
}

function callSnip(action, params) {
  return new Promise(function (resolve, reject) {
    if (!snipConn) {
      reject(new Error('Not connected to Snip app'));
      return;
    }

    var id = 'mcp-' + (++requestCounter);
    pendingRequests[id] = { resolve: resolve, reject: reject };

    var msg = JSON.stringify({ id: id, action: action, params: params || {} }) + '\n';
    snipConn.write(msg);
  });
}

// ── MCP Protocol Handler ──

function sendJsonRpc(obj) {
  var json = JSON.stringify(obj);
  var header = 'Content-Length: ' + Buffer.byteLength(json) + '\r\n\r\n';
  process.stdout.write(header + json);
}

function sendResult(id, result) {
  sendJsonRpc({ jsonrpc: '2.0', id: id, result: result });
}

function sendError(id, code, message) {
  sendJsonRpc({ jsonrpc: '2.0', id: id, error: { code: code, message: message } });
}

async function handleRequest(msg) {
  var id = msg.id;
  var method = msg.method;

  switch (method) {
    case 'initialize':
      sendResult(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
      });
      break;

    case 'notifications/initialized':
      // No-op — client is ready
      break;

    case 'tools/list':
      sendResult(id, { tools: TOOLS });
      break;

    case 'tools/call':
      await handleToolCall(id, msg.params);
      break;

    case 'ping':
      sendResult(id, {});
      break;

    default:
      if (id !== undefined) {
        sendError(id, -32601, 'Method not found: ' + method);
      }
  }
}

async function handleToolCall(id, params) {
  var toolName = params.name;
  var args = params.arguments || {};

  try {
    // Ensure connection to Snip app
    if (!snipConn) {
      await connectToSnip();
    }

    var result = await callSnip(toolName, args);

    // Format result as MCP content
    var content;
    if (result && result.dataURL) {
      // Image result — return as image content
      var match = result.dataURL.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        content = [
          { type: 'image', data: match[2], mimeType: match[1] },
          { type: 'text', text: JSON.stringify({ width: result.width, height: result.height }, null, 2) }
        ];
      } else {
        content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
      }
    } else {
      content = [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    }

    sendResult(id, { content: content });
  } catch (err) {
    sendResult(id, {
      content: [{ type: 'text', text: 'Error: ' + err.message }],
      isError: true
    });
  }
}

// ── Stdio Transport ──

function startStdioTransport() {
  let buffer = '';
  let contentLength = null;

  process.stdin.on('data', function (chunk) {
    buffer += chunk.toString();

    while (buffer.length > 0) {
      if (contentLength === null) {
        // Look for Content-Length header
        var headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) return;

        var header = buffer.slice(0, headerEnd);
        var match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          // Skip malformed header
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        contentLength = parseInt(match[1]);
        // Cap at 10 MB to prevent memory exhaustion
        if (contentLength > 10 * 1024 * 1024) {
          buffer = buffer.slice(headerEnd + 4);
          contentLength = null;
          continue;
        }
        buffer = buffer.slice(headerEnd + 4);
      }

      if (buffer.length < contentLength) return;

      var body = buffer.slice(0, contentLength);
      buffer = buffer.slice(contentLength);
      contentLength = null;

      try {
        var msg = JSON.parse(body);
        handleRequest(msg).catch(function (err) {
          if (msg.id !== undefined) {
            sendError(msg.id, -32603, err.message);
          }
        });
      } catch (err) {
        // Invalid JSON — skip
      }
    }
  });

  process.stdin.on('end', function () {
    process.exit(0);
  });
}

// ── Main ──

startStdioTransport();
