import AppKit
import Darwin
import Foundation

private struct MenuBarState: Decodable {
    let connected: Bool
    let remaining: Int?
    let resetLabel: String?
}

private final class MenuBarDelegate: NSObject, NSApplicationDelegate {
    private let parentPID: pid_t
    private let statePath: String
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var state = MenuBarState(connected: false, remaining: nil, resetLabel: nil)
    private var timer: Timer?

    init(parentPID: pid_t, statePath: String) {
        self.parentPID = parentPID
        self.statePath = statePath
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let button = statusItem.button {
            let icon = NSImage(systemSymbolName: "terminal.fill", accessibilityDescription: "瞬览")
            icon?.isTemplate = true
            button.image = icon
            button.imagePosition = .imageLeading
            button.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .semibold)
            button.toolTip = "瞬览 GlanceDeck"
        }
        setButtonTitle("···")
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
        setButtonTitle(remaining.map { "\($0)%" } ?? "···")
        statusItem.button?.toolTip = remaining.map { "瞬览 GlanceDeck · Codex 剩余 \($0)%" } ?? "瞬览 GlanceDeck · Codex 用量同步中"
        rebuildMenu()
    }

    private func setButtonTitle(_ title: String) {
        statusItem.button?.title = title
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
