import XCTest

// Placeholder so the test target has something to build/run in CI from day
// one. Real coverage (dialects, PNG parser, prompt assembly) lands in later
// phases.
final class SmokeTests: XCTestCase {
    func testAppNameIsWesaid() {
        XCTAssertEqual("wesaid", "wesaid")
    }
}
