#!/usr/bin/env swift

import AppKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let fileManager = FileManager.default
let root = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let sourceURL = root.appendingPathComponent("build/icon-f-v2.png")
let iconsetURL = root.appendingPathComponent("build/icon.iconset", isDirectory: true)
let icnsURL = root.appendingPathComponent("build/icon.icns")

guard
  let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
  let sourceImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
  fputs("Unable to load \(sourceURL.path)\n", stderr)
  exit(1)
}

try? fileManager.removeItem(at: iconsetURL)
try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)

// macOS does not mask Dock icons automatically. Keep a small transparent safety
// area and clip the artwork to a soft squircle so its white canvas never appears
// as a square tile in the Dock, Finder, Spotlight, or Launchpad.
func squirclePath(in rect: CGRect, exponent: CGFloat = 4.6) -> CGPath {
  let path = CGMutablePath()
  let center = CGPoint(x: rect.midX, y: rect.midY)
  let a = rect.width / 2
  let b = rect.height / 2
  let steps = 256

  for index in 0...steps {
    let angle = CGFloat(index) / CGFloat(steps) * 2 * .pi
    let cosine = cos(angle)
    let sine = sin(angle)
    let x = center.x + a * (cosine < 0 ? -1 : 1) * pow(abs(cosine), 2 / exponent)
    let y = center.y + b * (sine < 0 ? -1 : 1) * pow(abs(sine), 2 / exponent)
    let point = CGPoint(x: x, y: y)
    index == 0 ? path.move(to: point) : path.addLine(to: point)
  }

  path.closeSubpath()
  return path
}

func renderIcon(size: Int) throws -> Data {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    throw NSError(domain: "GlanceDeckIcon", code: 1)
  }

  context.clear(CGRect(x: 0, y: 0, width: size, height: size))
  context.interpolationQuality = .high

  let canvas = CGFloat(size)
  let inset = canvas * 0.048
  let maskRect = CGRect(x: inset, y: inset, width: canvas - inset * 2, height: canvas - inset * 2)
  context.saveGState()
  context.addPath(squirclePath(in: maskRect))
  context.clip()
  context.draw(sourceImage, in: CGRect(x: 0, y: 0, width: canvas, height: canvas))
  context.restoreGState()

  guard let outputImage = context.makeImage() else {
    throw NSError(domain: "GlanceDeckIcon", code: 2)
  }

  let data = NSMutableData()
  guard let pngDestination = CGImageDestinationCreateWithData(
    data,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else {
    throw NSError(domain: "GlanceDeckIcon", code: 3)
  }
  CGImageDestinationAddImage(pngDestination, outputImage, nil)
  guard CGImageDestinationFinalize(pngDestination) else {
    throw NSError(domain: "GlanceDeckIcon", code: 4)
  }
  return data as Data
}

let variants: [(filename: String, pixels: Int)] = [
  ("icon_16x16.png", 16),
  ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32),
  ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128),
  ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256),
  ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512),
  ("icon_512x512@2x.png", 1024),
]

for variant in variants {
  let outputURL = iconsetURL.appendingPathComponent(variant.filename)
  try renderIcon(size: variant.pixels).write(to: outputURL, options: .atomic)
}

try? fileManager.removeItem(at: icnsURL)
let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["--convert", "icns", iconsetURL.path, "--output", icnsURL.path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
  exit(iconutil.terminationStatus)
}

print("Generated rounded macOS icon at \(icnsURL.path)")
