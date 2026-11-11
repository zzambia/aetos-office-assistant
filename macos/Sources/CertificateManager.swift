// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 YOUBIQUO S.r.l.

import Foundation
import Security

struct CertificateManager {
    enum CertError: LocalizedError {
        case opensslFailed(String)
        case trustFailed(String)
        case identityUnavailable
        var errorDescription: String? {
            switch self {
            case .opensslFailed(let s): return "OpenSSL could not create the certificate: \(s)"
            case .trustFailed(let s): return "Could not trust the localhost certificate: \(s)"
            case .identityUnavailable: return "Could not load the localhost TLS identity"
            }
        }
    }

    let dir: URL

    private var certPEM: URL { dir.appendingPathComponent("localhost-cert.pem") }
    private var keyPEM: URL { dir.appendingPathComponent("localhost-key.pem") }
    private var p12: URL { dir.appendingPathComponent("localhost.p12") }
    private var config: URL { dir.appendingPathComponent("openssl.cnf") }
    private var thumbprint: URL { dir.appendingPathComponent("certificate-thumbprint.txt") }

    func ensure() throws {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if reusable() {
            try trustIfNeeded()
            return
        }
        _ = try generate(trust: true)
    }

    func loadIdentity() throws -> SecIdentity {
        guard FileManager.default.fileExists(atPath: p12.path) else { throw CertError.identityUnavailable }
        let data = try Data(contentsOf: p12)
        var items: CFArray?
        let status = SecPKCS12Import(data as CFData, [kSecImportExportPassphrase as String: "aetos-localhost"] as CFDictionary, &items)
        guard status == errSecSuccess,
              let list = items as? [[String: Any]],
              let first = list.first else {
            throw CertError.identityUnavailable
        }
        guard let identity = first[kSecImportItemIdentity as String] as! SecIdentity? else {
            throw CertError.identityUnavailable
        }
        return identity
    }

    @discardableResult
    func generate(trust: Bool) throws -> SecIdentity {
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        if trust, let old = try? String(contentsOf: thumbprint, encoding: .utf8) {
            let hash = old.trimmingCharacters(in: .whitespacesAndNewlines)
            if !hash.isEmpty {
                _ = Support.run("/usr/bin/security", ["delete-certificate", "-Z", hash, Support.loginKeychain])
            }
        }
        let conf = """
        [req]
        default_bits       = 2048
        prompt             = no
        default_md         = sha256
        distinguished_name = dn
        x509_extensions    = v3_req

        [dn]
        CN = localhost
        O  = AETOS Office Assistant

        [v3_req]
        basicConstraints = critical, CA:TRUE
        keyUsage         = critical, digitalSignature, keyEncipherment, keyCertSign
        extendedKeyUsage = serverAuth
        subjectAltName   = @alt_names

        [alt_names]
        DNS.1 = localhost
        IP.1  = 127.0.0.1
        IP.2  = ::1
        """
        try conf.write(to: config, atomically: true, encoding: .utf8)
        let made = Support.run("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "825", "-nodes", "-keyout", keyPEM.path, "-out", certPEM.path, "-config", config.path, "-extensions", "v3_req"])
        guard made.status == 0 else { throw CertError.opensslFailed(made.stderr.isEmpty ? made.stdout : made.stderr) }

        let exported = Support.run("/usr/bin/openssl", ["pkcs12", "-export", "-out", p12.path, "-inkey", keyPEM.path, "-in", certPEM.path, "-passout", "pass:aetos-localhost"])
        guard exported.status == 0 else { throw CertError.opensslFailed(exported.stderr) }

        let fingerprint = Support.run("/usr/bin/openssl", ["x509", "-in", certPEM.path, "-noout", "-fingerprint", "-sha1"])
        if fingerprint.status == 0, let line = fingerprint.stdout.components(separatedBy: .newlines).first,
           let eq = line.firstIndex(of: "=") {
            let hash = line[line.index(after: eq)...].replacingOccurrences(of: ":", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            try? hash.write(to: thumbprint, atomically: true, encoding: .utf8)
        }

        if trust { try addTrust(cert: certPEM) }
        return try loadIdentity()
    }

    func remove() {
        if let old = try? String(contentsOf: thumbprint, encoding: .utf8) {
            let hash = old.trimmingCharacters(in: .whitespacesAndNewlines)
            if !hash.isEmpty {
                _ = Support.run("/usr/bin/security", ["delete-certificate", "-Z", hash, Support.loginKeychain])
            }
        }
        for file in [p12, certPEM, keyPEM, config, thumbprint] {
            try? FileManager.default.removeItem(at: file)
        }
    }

    private func reusable() -> Bool {
        guard FileManager.default.fileExists(atPath: certPEM.path),
              FileManager.default.fileExists(atPath: keyPEM.path) else { return false }
        let check = Support.run("/usr/bin/openssl", ["x509", "-in", certPEM.path, "-noout", "-checkend", "604800"])
        return check.status == 0
    }

    private func trustIfNeeded() throws {
        let ok = Support.run("/usr/bin/security", ["verify-cert", "-c", certPEM.path, "-p", "ssl", "-s", "localhost"]).status == 0
        if !ok { try addTrust(cert: certPEM) }
    }

    private func addTrust(cert: URL) throws {
        let added = Support.run("/usr/bin/security", ["add-trusted-cert", "-r", "trustRoot", "-k", Support.loginKeychain, cert.path])
        guard added.status == 0 else { throw CertError.trustFailed(added.stderr.isEmpty ? added.stdout : added.stderr) }
        let verified = Support.run("/usr/bin/security", ["verify-cert", "-c", cert.path, "-p", "ssl", "-s", "localhost"])
        guard verified.status == 0 else { throw CertError.trustFailed(verified.stderr) }
    }
}
