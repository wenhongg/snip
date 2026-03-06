import Foundation
import Vision
import AppKit

// Read image path from command line argument, or base64 from stdin
func loadImage() -> CGImage? {
    if CommandLine.arguments.count > 1 {
        let path = CommandLine.arguments[1]
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
              let nsImage = NSImage(data: data),
              let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            return nil
        }
        return cgImage
    }

    // Read base64 from stdin
    var lines: [String] = []
    while let line = readLine(strippingNewline: true) {
        lines.append(line)
    }
    let input = lines.joined().trimmingCharacters(in: .whitespacesAndNewlines)

    // Strip data URL prefix if present
    let base64: String
    if let range = input.range(of: ";base64,") {
        base64 = String(input[range.upperBound...])
    } else {
        base64 = input
    }

    guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
          let nsImage = NSImage(data: data),
          let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return nil
    }
    return cgImage
}

func detectScripts(_ text: String) -> [String] {
    var counts: [String: Int] = [:]
    for scalar in text.unicodeScalars {
        let v = scalar.value
        if v >= 0x4E00 && v <= 0x9FFF || v >= 0x3400 && v <= 0x4DBF || v >= 0x20000 && v <= 0x2A6DF {
            counts["Chinese", default: 0] += 1
        } else if v >= 0xAC00 && v <= 0xD7AF || v >= 0x1100 && v <= 0x11FF {
            counts["Korean", default: 0] += 1
        } else if v >= 0x3040 && v <= 0x309F {
            counts["Japanese", default: 0] += 1
        } else if v >= 0x30A0 && v <= 0x30FF {
            counts["Japanese", default: 0] += 1
        } else if v >= 0x0400 && v <= 0x04FF {
            counts["Russian", default: 0] += 1
        } else if v >= 0x0041 && v <= 0x024F {
            counts["English", default: 0] += 1
        }
    }
    return counts.sorted { $0.value > $1.value }.map { $0.key }
}

func recognizeText(from image: CGImage) -> (String, [String]) {
    let semaphore = DispatchSemaphore(value: 0)
    var recognizedText = ""
    var detectedLanguages: [String] = []

    let request = VNRecognizeTextRequest { request, error in
        defer { semaphore.signal() }

        guard error == nil,
              let observations = request.results as? [VNRecognizedTextObservation] else {
            return
        }

        // Sort observations top-to-bottom, left-to-right for reading order
        let sorted = observations.sorted { a, b in
            let ay = 1.0 - a.boundingBox.origin.y - a.boundingBox.height
            let by = 1.0 - b.boundingBox.origin.y - b.boundingBox.height
            if abs(ay - by) < 0.02 {
                return a.boundingBox.origin.x < b.boundingBox.origin.x
            }
            return ay < by
        }

        let lines = sorted.compactMap { obs -> String? in
            obs.topCandidates(1).first?.string
        }
        recognizedText = lines.joined(separator: "\n")

        // Detect languages by Unicode script analysis
        if !recognizedText.isEmpty {
            detectedLanguages = detectScripts(recognizedText)
        }
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true

    request.recognitionLanguages = ["en", "zh-Hans", "zh-Hant", "ja", "ko",
                                    "fr", "de", "es", "pt", "it", "ru"]
    if #available(macOS 13.0, *) {
        request.automaticallyDetectsLanguage = true
    }

    let handler = VNImageRequestHandler(cgImage: image, options: [:])
    try? handler.perform([request])
    semaphore.wait()

    return (recognizedText, detectedLanguages)
}

// Main
guard let image = loadImage() else {
    let error: [String: Any] = ["success": false, "error": "Failed to load image"]
    if let data = try? JSONSerialization.data(withJSONObject: error),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
    exit(1)
}

let (text, languages) = recognizeText(from: image)

let result: [String: Any] = [
    "success": true,
    "text": text,
    "languages": languages.isEmpty ? ["unknown"] : languages
]

if let data = try? JSONSerialization.data(withJSONObject: result),
   let str = String(data: data, encoding: .utf8) {
    print(str)
}
