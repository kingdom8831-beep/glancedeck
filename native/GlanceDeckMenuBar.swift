import AppKit
import Darwin
import Foundation

private struct MenuBarState: Decodable {
    let connected: Bool
    let remaining: Int?
    let resetLabel: String?
}

private final class StatusBadgeView: NSView {
    var text = ">_ ···" { didSet { needsDisplay = true } }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        let badgeRect = bounds.insetBy(dx: 1, dy: 5)
        let background = NSBezierPath(roundedRect: badgeRect, xRadius: 7, yRadius: 7)
        NSColor(calibratedRed: 91 / 255, green: 124 / 255, blue: 250 / 255, alpha: 0.98).setFill()
        background.fill()
        let attributes: [NSAttributedString.Key: Any] = [
            .foregroundColor: NSColor.white,
            .font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold),
        ]
        let attributed = NSAttributedString(string: text, attributes: attributes)
        let size = attributed.size()
        attributed.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
    }
}

private final class MenuBarDelegate: NSObject, NSApplicationDelegate {
    private let parentPID: pid_t
    private let statePath: String
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let badgeView = StatusBadgeView(frame: .zero)
    private var state = MenuBarState(connected: false, remaining: nil, resetLabel: nil)
    private var timer: Timer?

    init(parentPID: pid_t, statePath: String) {
        self.parentPID = parentPID
        self.statePath = statePath
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.length = 66
        if let button = statusItem.button {
            button.title = ""
            button.toolTip = "瞬览 GlanceDeck"
            badgeView.frame = button.bounds
            badgeView.autoresizingMask = [.width, .height]
            button.addSubview(badgeView)
        }
        setButtonTitle(">_ ···")
        reloadState()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.tick()
        }
    }

    private func tick() {
        if kill(parentPID, 0) != 0 {
            NSApplication.shared.terminate(nil)
            return
        }
        reloadState()
    }

    private func reloadState() {
        if let data = FileManager.default.contents(atPath: statePath),
           let decoded = try? JSONDecoder().decode(MenuBarState.self, from: data) {
            state = decoded
        }
        let remaining = state.remaining.map { max(0, min(100, $0)) }
        setButtonTitle(remaining.map { ">_ \($0)%" } ?? ">_ ···")
        statusItem.button?.toolTip = remaining.map { "瞬览 GlanceDeck · Codex 剩余 \($0)%" } ?? "瞬览 GlanceDeck · Codex 用量同步中"
        rebuildMenu()
    }

    private func setButtonTitle(_ title: String) {
        badgeView.text = title
    }

    private func rebuildMenu() {
        let menu = NSMenu()
        let usageText = state.remaining.map { "Codex 剩余 \(max(0, min(100, $0)))%" } ?? "Codex 用量同步中"
        let usageItem = NSMenuItem(title: usageText, action: nil, keyEquivalent: "")
        usageItem.isEnabled = false
        menu.addItem(usageItem)
        if let resetLabel = state.resetLabel, !resetLabel.isEmpty {
            let resetItem = NSMenuItem(title: "本周期重置：\(resetLabel)", action: nil, keyEquivalent: "")
            resetItem.isEnabled = false
            menu.addItem(resetItem)
        }
        menu.addItem(.separator())
        menu.addItem(actionItem("显示 / 隐藏悬浮窗", #selector(toggleWindow), key: ""))
        menu.addItem(actionItem("立即刷新", #selector(refreshData), key: "r"))
        menu.addItem(.separator())
        menu.addItem(actionItem("退出瞬览", #selector(quitApp), key: "q"))
        statusItem.menu = menu
    }

    private func actionItem(_ title: String, _ action: Selector, key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    @objc private func toggleWindow() { kill(parentPID, SIGUSR1) }
    @objc private func refreshData() { kill(parentPID, SIGUSR2) }
    @objc private func quitApp() { kill(parentPID, SIGHUP) }
}

let arguments = CommandLine.arguments
guard arguments.count >= 3, let parent = Int32(arguments[1]) else { exit(2) }
let application = NSApplication.shared
private let delegate = MenuBarDelegate(parentPID: parent, statePath: arguments[2])
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
