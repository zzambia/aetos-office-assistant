import Foundation

enum SelfTest {
    static func run() -> Int32 {
        let args = CommandLine.arguments
        let live = args.contains("--self-test")
        let flag = live ? "--self-test" : "--self-test-routes"
        var reportPath = live ? "/tmp/aetos-self-test.txt" : "/tmp/aetos-self-test-routes.txt"
        if let index = args.firstIndex(of: flag), index + 1 < args.count {
            reportPath = args[index + 1]
        }

        var lines: [String] = []
        do {
            let assets = try AssetLoader.load(port: Support.port)
            guard let manifestText = String(data: assets["/manifest.xml"] ?? Data(), encoding: .utf8),
                  manifestText.contains("https://localhost:\(Support.port)") else {
                throw AppError("manifest was not rewritten to the app origin")
            }
            lines.append("PASS embedded web files and rewritten manifest")

            let server = AssetServer(port: Support.port, assets: assets)
            try routeChecks(server, into: &lines)

            if live {
                let tmp = FileManager.default.temporaryDirectory
                    .appendingPathComponent("aetos-self-test-\(UUID().uuidString)", isDirectory: true)
                try FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: tmp) }

                let cert = CertificateManager(dir: tmp)
                let identity = try cert.generate(trust: false)
                let liveServer = AssetServer(port: Support.port, assets: assets)
                do {
                    try liveServer.start(identity: identity)
                } catch {
                    throw AppError("live TLS server could not start (port in use or socket policy): \(error)", blocked: true)
                }
                defer { liveServer.stop() }
                try liveChecks(into: &lines)
            } else {
                lines.append("Route-only run: no certificate, keychain change or network connection performed.")
            }

            try lines.joined(separator: "\n").write(toFile: reportPath, atomically: true, encoding: .utf8)
            print(lines.joined(separator: "\n"))
            return 0
        } catch {
            lines.append("FAIL \(error.localizedDescription)")
            try? lines.joined(separator: "\n").write(toFile: reportPath, atomically: true, encoding: .utf8)
            print(lines.joined(separator: "\n"))
            return (error as? AppError)?.blocked == true ? 2 : 1
        }
    }

    private static func routeChecks(_ server: AssetServer, into lines: inout [String]) throws {
        for path in ["/health", "/index.html", "/src/app.js", "/assets/icon-32.png", "/manifest.xml"] {
            try expect(server, "GET \(path) HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n", 200, "route \(path)")
        }
        try expect(server, "GET /../localhost.p12 HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n", 404, "path traversal")
        try expect(server, "POST /index.html HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n", 405, "write method")
        try expect(server, "GET /index.html HTTP/1.1\r\nHost: elsewhere.example\r\n\r\n", 400, "foreign host")

        let base = server.respond(to: "GET /index.html HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n")
        for query in [
            "/index.html?_host_Info=Word$Mac$16.01$en-US$$$$0",
            "/?_host_Info=Word$Mac$16.01$en-US$$$$0",
            "/index.html?_host_Info=Word%24Mac&other=1",
            "/index.html?next=/../localhost.p12"
        ] {
            let queried = server.respond(to: "GET \(query) HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n")
            guard queried == base else { throw AppError("query-string routing regression: \(query)") }
        }
        try expect(server, "HEAD /index.html?_host_Info=Word HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n", 200, "HEAD with query")
        try expect(server, "GET /missing.html?_host_Info=Word HTTP/1.1\r\nHost: localhost:\(Support.port)\r\n\r\n", 404, "missing asset query guard")

        lines.append("PASS in-memory HTTP routes, security headers, traversal, write-method and foreign-host refusal")
        lines.append("PASS query-string and HEAD equivalence checks including the Word host-info URL")
    }

    private static func expect(_ server: AssetServer, _ request: String, _ status: Int, _ what: String) throws {
        let response = server.respond(to: request)
        let terminator = Data("\r\n\r\n".utf8)
        guard let range = response.range(of: terminator) else { throw AppError("response without header terminator for \(what)") }
        let headerData = response[..<range.lowerBound]
        guard let head = String(data: headerData, encoding: .utf8) else { throw AppError("non-text response header for \(what)") }
        guard head.hasPrefix("HTTP/1.1 \(status)") else {
            throw AppError("\(what): expected \(status), got \(head.prefix(24))")
        }
        if status == 200 {
            guard head.contains("Content-Security-Policy:") else { throw AppError("\(what): missing CSP header") }
        }
    }

    private static func liveChecks(into lines: inout [String]) throws {
        let health = Support.run("/usr/bin/curl", ["-sk", "-m", "5", "https://127.0.0.1:\(Support.port)/health"])
        guard health.status == 0, health.stdout == "AETOS Office Assistant ready" else {
            throw AppError("live TLS /health probe failed: \(health.stderr)")
        }
        let headers = Support.run("/usr/bin/curl", ["-sk", "-m", "5", "-D", "-", "-o", "/dev/null", "https://127.0.0.1:\(Support.port)/index.html"])
        guard headers.status == 0, headers.stdout.hasPrefix("HTTP/1.1 200"), headers.stdout.contains("Content-Security-Policy:") else {
            throw AppError("live TLS header probe failed")
        }
        lines.append("PASS live TLS routes and security headers")
    }
}
