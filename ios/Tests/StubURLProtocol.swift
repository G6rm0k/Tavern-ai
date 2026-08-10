import Foundation

/// Feeds a canned response back through a real `URLSession`, without a real
/// network. `chunks` are delivered as separate `didLoad` calls so a streaming
/// response can be simulated one SSE line-group at a time — the same shape
/// `URLSession.bytes(for:).lines` sees from a real connection.
final class StubURLProtocol: URLProtocol {

    struct Stub {
        let statusCode: Int
        let chunks: [Data]
    }

    /// Keyed by request handling, not by fixed URL string, so a test can
    /// distinguish `/chat/completions` from `/messages` on the same host.
    static var requestHandler: ((URLRequest) -> Stub)?

    static func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = StubURLProtocol.requestHandler, let url = request.url else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        let stub = handler(request)
        guard let response = HTTPURLResponse(url: url, statusCode: stub.statusCode, httpVersion: "HTTP/1.1", headerFields: nil) else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in stub.chunks {
            client?.urlProtocol(self, didLoad: chunk)
        }
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// One SSE chunk per array element, formatted the way a real server writes
/// them (`data: ...\n\n`) and turned to bytes — helper so tests read as a
/// list of events, not a wall of escaped newlines.
func sseChunks(_ lines: [String]) -> [Data] {
    lines.map { Data("data: \($0)\n\n".utf8) }
}
