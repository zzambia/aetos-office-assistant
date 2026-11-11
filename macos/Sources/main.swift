// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

import AppKit

let port = Support.port

if CommandLine.arguments.contains("--self-test-routes") || CommandLine.arguments.contains("--self-test") {
    exit(SelfTest.run())
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var server: AssetServer?
    private var statusItem: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard Support.acquireSingleInstanceLock() else {
            showAlert(title: "AETOS Office Assistant",
                      message: "AETOS Office Assistant is already running. Use its menu bar icon, or open Word.")
            NSApp.terminate(nil)
            return
        }
        do {
            let assets = try AssetLoader.load(port: port)
            let cert = CertificateManager(dir: Support.appSupport)
            try cert.ensure()

            let firstRun = !FileManager.default.fileExists(atPath: Support.installed.path)
            try Support.sideloadManifest(assets["/manifest.xml"] ?? Data())
            if firstRun {
                try "AETOS Office Assistant mac \(Self.versionString)".write(to: Support.installed, atomically: true, encoding: .utf8)
            }

            let identity = try cert.loadIdentity()
            let server = AssetServer(port: port, assets: assets)
            try server.start(identity: identity)
            self.server = server

            setupMenuBar()
            if firstRun {
                showInstructions()
                _ = Support.openWord()
            }
        } catch {
            showAlert(title: "AETOS Office Assistant",
                      message: "AETOS Office Assistant could not finish setup or start.\n\n\(error.localizedDescription)\n\nYour macOS or Office policy may block certificate trust or add-in registration. See docs/MAC.md and docs/CI.md.")
            NSApp.terminate(nil)
        }
    }

    static var versionString: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "0.0.0"
    }

    private func setupMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            if let icon = NSImage(contentsOfFile: Bundle.main.path(forResource: "menu-bar-icon", ofType: "png") ?? "") {
                icon.size = NSSize(width: 18, height: 18)
                button.image = icon
            } else {
                button.title = "AETOS"
            }
        }
        let menu = NSMenu()

        let openWord = NSMenuItem(title: "Open Microsoft Word", action: #selector(openWordAction), keyEquivalent: "")
        openWord.target = self
        menu.addItem(openWord)

        let help = NSMenuItem(title: "How to open AETOS Office Assistant in Word", action: #selector(showInstructions), keyEquivalent: "")
        help.target = self
        menu.addItem(help)

        let autoStart = NSMenuItem(title: "Start at login", action: #selector(toggleAutoStart(_:)), keyEquivalent: "")
        autoStart.target = self
        autoStart.state = Support.launchAgentEnabled() ? .on : .off
        menu.addItem(autoStart)

        menu.addItem(.separator())

        let remove = NSMenuItem(title: "Remove AETOS Office Assistant setup", action: #selector(removeSetupAction), keyEquivalent: "")
        remove.target = self
        menu.addItem(remove)

        let quit = NSMenuItem(title: "Quit AETOS Office Assistant", action: #selector(quitAction), keyEquivalent: "q")
        quit.target = self
        menu.addItem(quit)

        item.menu = menu
        statusItem = item
    }

    @objc private func openWordAction() {
        if !Support.openWord() {
            showAlert(title: "Open Microsoft Word",
                      message: "Open Microsoft Word from Applications, then choose AETOS Office Assistant from Insert > Add-ins.")
        }
    }

    @objc private func showInstructions() {
        showAlert(title: "AETOS Office Assistant",
                  message: "AETOS Office Assistant is running in your menu bar.\n\nRestart Word if it was open during setup. In Word, choose Insert > Add-ins (older builds: Insert > My Add-ins) and select AETOS Office Assistant.\n\nThen choose Model connection and save your endpoint, model and optional key. No server terminal or npm command is needed.\n\nIf your organization blocks developer add-ins, ask its administrator to deploy the included manifest. This is still a preview release.")
    }

    @objc private func toggleAutoStart(_ sender: NSMenuItem) {
        do {
            try Support.setLaunchAtLogin(sender.state != .on)
            sender.state = Support.launchAgentEnabled() ? .on : .off
        } catch {
            sender.state = Support.launchAgentEnabled() ? .on : .off
            showAlert(title: "AETOS Office Assistant", message: "macOS did not allow this startup setting.")
        }
    }

    @objc private func removeSetupAction() {
        let alert = NSAlert()
        alert.messageText = "Remove AETOS Office Assistant setup"
        alert.informativeText = "Remove startup, Word registration and the local certificate? Saved model connections stay in Word's browser storage. The app remains so you can delete or reinstall it."
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Remove")
        alert.addButton(withTitle: "Cancel")
        NSApp.activate(ignoringOtherApps: true)
        guard alert.runModal() == .alertFirstButtonReturn else { return }

        try? Support.setLaunchAtLogin(false)
        try? FileManager.default.removeItem(at: Support.manifestInWef)
        CertificateManager(dir: Support.appSupport).remove()
        try? FileManager.default.removeItem(at: Support.installed)
        server?.stop()
        NSApp.terminate(nil)
    }

    @objc private func quitAction() {
        NSApp.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = .informational
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
