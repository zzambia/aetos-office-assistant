// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

import Foundation
import Darwin

struct AppError: LocalizedError {
    let message: String
    var blocked = false
    init(_ message: String, blocked: Bool = false) {
        self.message = message
        self.blocked = blocked
    }
    var errorDescription: String? { message }
}

enum Support {
    static let port: UInt16 = 38473

    static var appSupport: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
            .appendingPathComponent("AETOS Office Assistant", isDirectory: true)
    }
    static var installed: URL { appSupport.appendingPathComponent("installed.txt") }
    static var lockFile: URL { appSupport.appendingPathComponent("aetos.lock") }
    static var wordWef: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Containers/com.microsoft.Word/Data/Documents/wef", isDirectory: true)
    }
    static var manifestInWef: URL { wordWef.appendingPathComponent("aetos-office-assistant.xml") }
    static var launchAgent: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/it.aetos-ai.office-assistant.plist")
    }
    static var loginKeychain: String {
        FileManager.default.homeDirectoryForCurrentUser.path + "/Library/Keychains/login.keychain-db"
    }

    private static var lockFD: Int32 = -1

    @discardableResult
    static func run(_ tool: String, _ args: [String]) -> (status: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: tool)
        process.arguments = args
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        do { try process.run() } catch { return (-1, "", error.localizedDescription) }
        process.waitUntilExit()
        let stdout = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        let stderr = String(data: err.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        return (process.terminationStatus, stdout, stderr)
    }

    static func sideloadManifest(_ manifest: Data) throws {
        try FileManager.default.createDirectory(at: wordWef, withIntermediateDirectories: true)
        try manifest.write(to: manifestInWef)
    }

    static func launchAgentEnabled() -> Bool {
        FileManager.default.fileExists(atPath: launchAgent.path)
    }

    static func setLaunchAtLogin(_ enabled: Bool) throws {
        if enabled {
            let executable = Bundle.main.executableURL?.path ?? ""
            let plist: [String: Any] = [
                "Label": "it.aetos-ai.office-assistant",
                "ProgramArguments": [executable],
                "RunAtLoad": true
            ]
            let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
            try data.write(to: launchAgent)
            _ = run("/bin/launchctl", ["load", launchAgent.path])
        } else {
            _ = run("/bin/launchctl", ["bootout", "gui/\(getuid())/it.aetos-ai.office-assistant"])
            try? FileManager.default.removeItem(at: launchAgent)
        }
    }

    static func openWord() -> Bool {
        run("/usr/bin/open", ["-a", "Microsoft Word"]).status == 0
    }

    static func acquireSingleInstanceLock() -> Bool {
        try? FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
        let fd = Darwin.open(lockFile.path, O_CREAT | O_RDWR, 0o644)
        guard fd >= 0 else { return false }
        if flock(fd, LOCK_EX | LOCK_NB) != 0 {
            Darwin.close(fd)
            return false
        }
        lockFD = fd
        return true
    }
}
