import Foundation
import Vision
import AppKit

struct Line: Codable {
    let text: String
    let y: Double
    let h: Double
}

let paths = Array(CommandLine.arguments.dropFirst())
var out: [String: [Line]] = [:]

for path in paths {
    let url = URL(fileURLWithPath: path)
    guard let img = NSImage(contentsOf: url),
          let tiff = img.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let cg = rep.cgImage else {
        out[path] = []
        continue
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["uk-UA", "ru-RU", "en-US"]
    request.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([request])
    let lines: [Line] = (request.results ?? []).compactMap { observation in
        guard let text = observation.topCandidates(1).first?.string else { return nil }
        let box = observation.boundingBox
        return Line(text: text, y: Double(box.origin.y), h: Double(box.height))
    }
    out[path] = lines.sorted { $0.y > $1.y }
}

let data = try JSONSerialization.data(withJSONObject: out.mapValues { lines in
    lines.map { ["text": $0.text, "y": $0.y, "h": $0.h] }
}, options: [])
FileHandle.standardOutput.write(data)
