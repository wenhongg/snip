#include <napi.h>
#include <algorithm>
#include <map>
#include <vector>
#include <string>
#import <Cocoa/Cocoa.h>
#import <CoreGraphics/CoreGraphics.h>

// Set NSWindowCollectionBehaviorMoveToActiveSpace on an Electron BrowserWindow.
// This tells macOS to move the window to whichever Space is currently active
// when the window is shown, solving the issue where overlay windows appear
// on the wrong Space.
//
// Usage from JS:
//   const handle = browserWindow.getNativeWindowHandle();
//   windowUtils.setMoveToActiveSpace(handle);

Napi::Boolean SetMoveToActiveSpace(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected Buffer from getNativeWindowHandle()")
        .ThrowAsJavaScriptException();
    return Napi::Boolean::New(env, false);
  }

  auto buf = info[0].As<Napi::Buffer<uint8_t>>();
  // getNativeWindowHandle() returns a pointer to the NSView* as raw bytes.
  // Use __unsafe_unretained to avoid ARC ownership issues with reinterpret_cast.
  void* rawPtr = *reinterpret_cast<void**>(buf.Data());
  NSView* __unsafe_unretained view = (__bridge NSView*)rawPtr;
  NSWindow* window = [view window];

  if (window) {
    NSWindowCollectionBehavior behavior = [window collectionBehavior];
    // Remove canJoinAllSpaces (shows on every Space — not what we want)
    behavior &= ~NSWindowCollectionBehaviorCanJoinAllSpaces;
    // Add moveToActiveSpace (moves to current Space when shown)
    behavior |= NSWindowCollectionBehaviorMoveToActiveSpace;
    [window setCollectionBehavior:behavior];
    return Napi::Boolean::New(env, true);
  }

  return Napi::Boolean::New(env, false);
}

// Get on-screen window list with bounds, owner, and title.
// Sub-windows from the same app (PID) are merged into a single bounding rect
// so that clicking a browser selects the full window, not individual sub-panes.
// Returns an array of { x, y, width, height, owner, name, layer } objects
// sorted by area ascending (smallest first). Filters to the specified display bounds.
//
// Usage from JS:
//   const windows = windowUtils.getWindowList(displayX, displayY, displayW, displayH);
Napi::Value GetWindowList(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();

  // Optional display bounds filter
  double dispX = 0, dispY = 0, dispW = 0, dispH = 0;
  bool hasDisplayFilter = (info.Length() >= 4);
  if (hasDisplayFilter) {
    dispX = info[0].As<Napi::Number>().DoubleValue();
    dispY = info[1].As<Napi::Number>().DoubleValue();
    dispW = info[2].As<Napi::Number>().DoubleValue();
    dispH = info[3].As<Napi::Number>().DoubleValue();
  }

  CFArrayRef windowList = CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  );

  if (!windowList) {
    return Napi::Array::New(env, 0);
  }

  CFIndex count = CFArrayGetCount(windowList);

  // Collect windows with spatial clustering per PID.
  // CGWindowList returns sub-windows (toolbar, content area, etc.) as separate entries.
  // We merge sub-windows that overlap/touch (within 2px) so clicking a browser selects
  // the full window. Separate windows of the same app stay distinct.
  // Z-order is preserved from CGWindowList (front-to-back).
  struct WinInfo {
    CGRect bounds;
    std::string owner;
    std::string name;
    pid_t pid;
    double largestSubArea;
    int zOrder;
  };

  std::vector<WinInfo> clusters;
  int zIndex = 0;

  for (CFIndex i = 0; i < count; i++) {
    NSDictionary* entry = (__bridge NSDictionary*)CFArrayGetValueAtIndex(windowList, i);

    int layer = [entry[(__bridge NSString*)kCGWindowLayer] intValue];
    if (layer != 0) continue;

    CGRect bounds;
    NSDictionary* boundsDict = entry[(__bridge NSString*)kCGWindowBounds];
    if (!boundsDict) continue;
    CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDict, &bounds);

    if (bounds.size.width < 50 || bounds.size.height < 50) continue;

    if (hasDisplayFilter) {
      CGRect dispRect = CGRectMake(dispX, dispY, dispW, dispH);
      if (!CGRectIntersectsRect(bounds, dispRect)) continue;
    }

    NSString* owner = entry[(__bridge NSString*)kCGWindowOwnerName] ?: @"";
    NSString* name  = entry[(__bridge NSString*)kCGWindowName] ?: @"";

    if ([owner isEqualToString:@"Snip"] || [owner isEqualToString:@"Electron"]) continue;

    pid_t pid = [entry[(__bridge NSString*)kCGWindowOwnerPID] intValue];
    double area = bounds.size.width * bounds.size.height;

    // Find existing cluster with same PID that spatially overlaps/touches
    WinInfo* match = nullptr;
    for (auto& c : clusters) {
      if (c.pid == pid && CGRectIntersectsRect(CGRectInset(c.bounds, -2, -2), bounds)) {
        match = &c;
        break;
      }
    }

    if (match) {
      match->bounds = CGRectUnion(match->bounds, bounds);
      if (area > match->largestSubArea && [name length] > 0) {
        match->name = std::string([name UTF8String]);
        match->largestSubArea = area;
      }
    } else {
      clusters.push_back({
        bounds,
        std::string([owner UTF8String]),
        std::string([name UTF8String]),
        pid,
        area,
        zIndex++
      });
    }
  }

  // Sort front-to-back (z-order) so findWindowAt picks the topmost window
  std::sort(clusters.begin(), clusters.end(), [](const WinInfo& a, const WinInfo& b) {
    return a.zOrder < b.zOrder;
  });

  Napi::Array result = Napi::Array::New(env);
  uint32_t idx = 0;
  for (auto& w : clusters) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("x", Napi::Number::New(env, w.bounds.origin.x));
    obj.Set("y", Napi::Number::New(env, w.bounds.origin.y));
    obj.Set("width", Napi::Number::New(env, w.bounds.size.width));
    obj.Set("height", Napi::Number::New(env, w.bounds.size.height));
    obj.Set("owner", Napi::String::New(env, w.owner));
    obj.Set("name", Napi::String::New(env, w.name));
    obj.Set("layer", Napi::Number::New(env, 0));
    result.Set(idx++, obj);
  }

  CFRelease(windowList);
  return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("setMoveToActiveSpace",
              Napi::Function::New(env, SetMoveToActiveSpace));
  exports.Set("getWindowList",
              Napi::Function::New(env, GetWindowList));
  return exports;
}

NODE_API_MODULE(window_utils, Init)
