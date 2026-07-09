import Foundation
import Vision
import AppKit

// usage: swift ocr.swift <image1> [image2 ...] — prints JSON lines:
// {"file":..., "items":[{"text":..., "x":..., "y":..., "w":..., "h":...}]}
// coordinates normalized, origin TOP-left.
for path in CommandLine.arguments.dropFirst() {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        print("{\"file\":\"\(path)\",\"error\":\"unreadable\"}")
        continue
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([request])
    var items: [String] = []
    for obs in request.results ?? [] {
        guard let cand = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox
        let text = cand.string.replacingOccurrences(of: "\\", with: " ")
                              .replacingOccurrences(of: "\"", with: "'")
        items.append("{\"text\":\"\(text)\",\"x\":\(b.minX),\"y\":\(1 - b.maxY),\"w\":\(b.width),\"h\":\(b.height)}")
    }
    print("{\"file\":\"\(path)\",\"items\":[\(items.joined(separator: ","))]}")
}
