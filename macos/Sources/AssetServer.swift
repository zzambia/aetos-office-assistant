import Foundation
import Network
import Security

enum AssetLoader {
    static func load(port: UInt16) throws -> [String: Data] {
        guard let web = Bundle.main.resourceURL?.appendingPathComponent("web") else {
            throw AppError("embedded web assets are missing")
        }
        var assets: [String: Data] = [:]
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: web, includingPropertiesForKeys: [.isDirectoryKey]) else {
            throw AppError("could not enumerate embedded web assets")
        }
        for case let url as URL in enumerator {
            let values = try? url.resourceValues(forKeys: [.isDirectoryKey])
            if values?.isDirectory == true { continue }
            let rel = url.path.replacingOccurrences(of: web.path + "/", with: "")
            assets["/" + rel] = try Data(contentsOf: url)
        }
        if let manifest = assets["/manifest.xml"], let text = String(data: manifest, encoding: .utf8) {
            assets["/manifest.xml"] = Data(text.replacingOccurrences(of: "https://localhost:3000", with: "https://localhost:\(port)").utf8)
        }
        assets["/health"] = Data("AETOS Office Assistant ready".utf8)
        return assets
    }
}

final class AssetServer {
    let port: UInt16
    let assets: [String: Data]
    private var listeners: [NWListener] = []
    private var clients: [ObjectIdentifier: Client] = [:]
    private let clientsLock = NSLock()
    private let queue = DispatchQueue(label: "aetos.server.queue", qos: .userInitiated)

    init(port: UInt16, assets: [String: Data]) {
        self.port = port
        self.assets = assets
    }

    func start(identity: SecIdentity) throws {
        try startListener(host: "127.0.0.1", identity: identity, required: true)
        try? startListener(host: "::1", identity: identity, required: false)
    }

    func stop() {
        for listener in listeners { listener.cancel() }
        listeners.removeAll()
    }

    private func startListener(host: String, identity: SecIdentity, required: Bool) throws {
        let semaphore = DispatchSemaphore(value: 0)
        var failure: Error?

        let tls = NWProtocolTLS.Options()
        guard let secIdentity = sec_identity_create(identity) else { throw AppError("could not create TLS identity") }
        sec_protocol_options_set_local_identity(tls.securityProtocolOptions, secIdentity)
        sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)

        let params = NWParameters(tls: tls)
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!)

        let listener: NWListener
        do { listener = try NWListener(using: params) } catch {
            if required { throw error }
            return
        }
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready: semaphore.signal()
            case .failed(let error): failure = error; semaphore.signal()
            case .cancelled: if failure == nil { failure = AppError("listener cancelled") }; semaphore.signal()
            default: break
            }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.handle(connection) }
        listener.start(queue: queue)
        if semaphore.wait(timeout: .now() + 5) == .timedOut {
            listener.cancel()
            if required { throw AppError("listener on \(host) did not start") }
            return
        }
        if let failure = failure {
            if required { throw failure }
            return
        }
        listeners.append(listener)
    }

    private func handle(_ connection: NWConnection) {
        let client = Client(connection: connection, server: self)
        clientsLock.lock()
        clients[ObjectIdentifier(connection)] = client
        clientsLock.unlock()
        connection.stateUpdateHandler = { [weak self, weak client] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                client?.receive()
            case .failed, .cancelled:
                self.clientsLock.lock()
                self.clients.removeValue(forKey: ObjectIdentifier(connection))
                self.clientsLock.unlock()
            default:
                break
            }
        }
        connection.start(queue: queue)
    }

    func respond(to raw: String) -> Data {
        let lines = raw.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
            return Self.reply(400, "text/plain", Data("Bad request".utf8), head: false)
        }
        let parts = requestLine.split(separator: " ", omittingEmptySubsequences: true).map(String.init)
        var host = ""
        for line in lines where line.lowercased().hasPrefix("host:") {
            host = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
        }
        guard parts.count == 3, raw.count < 16384, raw.hasSuffix("\r\n\r\n"),
              host == "localhost:\(port)" || host == "127.0.0.1:\(port)" else {
            return Self.reply(400, "text/plain", Data("Bad request".utf8), head: false)
        }
        let method = parts[0]
        guard method == "GET" || method == "HEAD" else {
            return Self.reply(405, "text/plain", Data(), head: false)
        }
        var path = parts[1]
        if let query = path.firstIndex(of: "?") { path = String(path[..<query]) }
        if path == "/" { path = "/index.html" }
        guard let data = assets[path] else {
            return Self.reply(404, "text/plain", Data(), head: false)
        }
        return Self.reply(200, Self.contentType(for: path), data, head: method == "HEAD")
    }

    static func contentType(for path: String) -> String {
        switch (path as NSString).pathExtension {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "xml": return "application/xml"
        case "svg": return "image/svg+xml"
        case "ico": return "image/x-icon"
        default: return "text/plain"
        }
    }

    static func reply(_ status: Int, _ type: String, _ body: Data, head: Bool) -> Data {
        let reason = status == 200 ? " OK" : " Error"
        let header = "HTTP/1.1 \(status)\(reason)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'self'; script-src 'self' https://appsforoffice.microsoft.com; style-src 'self'; img-src 'self'; connect-src https: http://localhost:* http://127.0.0.1:* http://[::1]:*; object-src 'none'; base-uri 'none'\r\n\r\n"
        var out = Data(header.utf8)
        if !head { out.append(body) }
        return out
    }

    private final class Client {
        let connection: NWConnection
        let server: AssetServer
        var buffer = Data()
        var sent = false

        init(connection: NWConnection, server: AssetServer) {
            self.connection = connection
            self.server = server
        }

        func receive() {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
                guard let self = self else { return }
                if let data = data { self.buffer.append(data) }
                let terminator = Data("\r\n\r\n".utf8)
                if !self.sent && (self.buffer.range(of: terminator) != nil || self.buffer.count >= 16384) {
                    self.sent = true
                    let raw = String(data: self.buffer, encoding: .utf8) ?? ""
                    let response = self.server.respond(to: raw)
                    self.connection.send(content: response, completion: .contentProcessed { _ in
                        self.connection.cancel()
                    })
                    return
                }
                if isComplete || error != nil {
                    self.connection.cancel()
                } else {
                    self.receive()
                }
            }
        }
    }
}
