import XCTest
import UIKit

/// Screen Time Basic flow against the synthetic fixture
/// (tests/fixtures/ios-family-assistance-server.js, which runs the real
/// lib/screen-time.js). Start the fixture before running. Tests that depend on
/// a kid's starting state wipe the family's Screen Time first
/// (`POST /__qa/screen-time/reset`), so they pass in any order.
final class ScreenTimeUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18247")!
    private let leo = "qa-visual-kid-2"

    override func setUp() { continueAfterFailure = false }

    func testParentTurnsOnBedtimeAndDailyTimeInTwoTaps() {
        resetScreenTime()
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["Leo Visual, Screen Time"].firstMatch
        XCTAssertTrue(app.staticTexts["Maya Visual"].firstMatch.waitForExistence(timeout: 12))
        reveal(row, app)
        attach("parent-today-card")
        row.tap()

        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 8))
        attach("parent-basic-first-run")
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'authorization' OR label CONTAINS[c] 'cooperative' OR label CONTAINS[c] 'token'")).firstMatch.exists)
        bedtime.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        let daily = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Daily screen time'")).firstMatch
        daily.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        attach("parent-basic-on")

        let save = app.buttons["Save"].firstMatch
        reveal(save, app)
        save.tap()
        // Saved = the draft matches the server again, so Save disables.
        let saved = expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: save)
        wait(for: [saved], timeout: 8)
        attach("parent-basic-saved")
    }

    func testKidSeesDealCardAndWalksTheDealUpToTurnOn() {
        parentTurnsOnBedtime(for: "Maya Visual")
        let app = launch(.kid)
        let card = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Make our Screen Time deal'")).firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 12))
        reveal(card, app)
        attach("kid-deal-card")
        app.buttons["Let's make it"].firstMatch.tap()

        // Fixture-free pages only: device routes 401 in the fixture, so stop at "Turn it on".
        XCTAssertTrue(app.staticTexts["Let's make a deal"].waitForExistence(timeout: 6))
        attach("kid-deal-hello")
        app.buttons["Let's go"].tap()
        XCTAssertTrue(app.staticTexts["The plan"].waitForExistence(timeout: 4))
        attach("kid-deal-plan")
        app.buttons["Sounds fair"].tap()
        XCTAssertTrue(app.staticTexts["Your promises"].waitForExistence(timeout: 4))
        let next = app.buttons["Next"].firstMatch
        XCTAssertFalse(next.isEnabled)
        app.buttons["Homework before games"].tap()
        XCTAssertTrue(next.isEnabled)
        attach("kid-deal-kid-promises")
        next.tap()
        XCTAssertTrue(app.staticTexts["Pass the phone to your grown-up"].waitForExistence(timeout: 4))
        app.buttons["I'm the grown-up"].tap()
        XCTAssertTrue(app.staticTexts["Grown-up promises"].waitForExistence(timeout: 4))
        app.buttons["We'll review this together in a month"].tap()
        attach("kid-deal-parent-promises")
        app.buttons["Next"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Turn it on"].waitForExistence(timeout: 4))
        attach("kid-deal-turn-on")
    }

    /// No Family Sharing device in the fixture: Advanced shows the honest empty state
    /// instead of Apple's report, and Basic shows no usage line without reported minutes.
    func testParentDetailedUsageEmptyStateWithoutFamilySharing() {
        resetScreenTime()
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["Leo Visual, Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 12))
        reveal(row, app)
        row.tap()
        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 8))
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Today: '")).firstMatch.exists)
        let advanced = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Advanced'")).firstMatch
        reveal(advanced, app)
        advanced.tap()
        let empty = app.staticTexts["App-by-app details need Family Sharing. You'll still see daily totals on fametc.com and here."]
        reveal(empty, app)
        attach("parent-detailed-usage-empty")
    }

    /// Makes sure the fixture kid has an enabled policy (idempotent across runs).
    private func parentTurnsOnBedtime(for kidName: String) {
        resetScreenTime()
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["\(kidName), Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 12))
        reveal(row, app)
        row.tap()
        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 8))
        if bedtime.value as? String == "0" {
            bedtime.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
            let save = app.buttons["Save"].firstMatch
            reveal(save, app)
            save.tap()
            let saved = expectation(for: NSPredicate(format: "isEnabled == false"), evaluatedWith: save)
            wait(for: [saved], timeout: 8)
        }
        app.terminate()
    }

    func testParentApprovesMoreTimeRequest() throws {
        let kid = "qa-visual-kid-1"
        resetScreenTime()
        post("/__qa/screen-time/credit", ["kidId": kid, "amount": 12], role: .parent)
        post("/api/screen-time/kids/\(kid)/policy", ["enabled": true,
            "limits": [["id": "total", "kind": "total", "name": "Screen time", "minutesPerDay": 120, "weekendMinutes": 180]],
            "downtime": [["id": "bedtime", "name": "Bedtime", "start": "21:00", "end": "07:00", "days": [1, 2, 3, 4, 5, 6, 7]]]],
            role: .parent, method: "PUT")
        let day = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withFullDate])
        post("/api/screen-time/requests", ["minutes": 15, "date": day, "note": "Finishing a level"], role: .kid)

        let app = launch(.parent)
        let review = app.buttons.matching(NSPredicate(format: "label CONTAINS 'Review'")).firstMatch
        XCTAssertTrue(review.waitForExistence(timeout: 12), "Pending request banner should show")
        attach("parent-request-banner")
        review.tap()
        let approve = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Approve 15 more minutes'")).firstMatch
        XCTAssertTrue(approve.waitForExistence(timeout: 8))
        attach("parent-request-card")
        approve.tap()
        XCTAssertTrue(approve.waitForNonExistence(timeout: 8), "Card should leave the pending state")
        attach("parent-request-approved")
    }


    // MARK: Banner, Off state, iPad presentation (docs/SCREEN-TIME-UX.md WP3)

    /// A real revoked alert (the fixture runs heartbeat() with "denied"): the banner shows
    /// it, ✕ dismisses it in one tap (and the ack sticks), Review opens the controls.
    func testParentBannerAlertDismissesAndReviewOpensControls() {
        resetScreenTime()
        XCTAssertEqual(post("/__qa/screen-time/alert", ["kidId": leo, "type": "revoked"], role: .parent), 200)
        var app = launch(.parent)
        var banner = app.descendants(matching: .any)["screentime.banner.alert"].firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 12), "Seeded alert should show in the banner")
        XCTAssertTrue(app.staticTexts["Leo Visual turned off Screen Time on iPad"].exists)
        attach("parent-alert-banner")
        let dismiss = app.buttons["screentime.banner.dismiss"].firstMatch
        XCTAssertTrue(dismiss.isHittable)
        XCTAssertGreaterThanOrEqual(dismiss.frame.width, 44)
        dismiss.tap()
        XCTAssertTrue(banner.waitForNonExistence(timeout: 4), "✕ hides the alert at once")
        attach("parent-alert-dismissed")
        var tries = 0
        while tries < 10 && openAlertCount(leo) != 0 { tries += 1; Thread.sleep(forTimeInterval: 0.5) }
        XCTAssertEqual(openAlertCount(leo), 0, "✕ acks that alert on the server")
        app.terminate()

        // The ack reached the server: once the overview is loaded again, no banner.
        app = launch(.parent)
        waitForStatus("Leo Visual", beginsWith: "Turned off", in: app)
        XCTAssertFalse(app.descendants(matching: .any)["screentime.banner.alert"].exists)
        app.terminate()

        // A new alert → Review opens Leo's controls, where it has its own ✕.
        XCTAssertEqual(post("/__qa/screen-time/alert", ["kidId": leo, "type": "revoked"], role: .parent), 200)
        app = launch(.parent)
        banner = app.descendants(matching: .any)["screentime.banner.alert"].firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 12))
        app.buttons["screentime.banner.review"].firstMatch.tap()
        let status = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Leo Visual turned it off'")).firstMatch
        XCTAssertTrue(status.waitForExistence(timeout: 8), "Review should open Leo's controls")
        XCTAssertTrue(app.buttons["screentime.controls.done"].firstMatch.exists)
        let rowDismiss = app.buttons["screentime.alert.dismiss"].firstMatch
        XCTAssertTrue(rowDismiss.waitForExistence(timeout: 4))
        attach("parent-controls-from-review")
        rowDismiss.tap()
        XCTAssertTrue(rowDismiss.waitForNonExistence(timeout: 4), "Sheet ✕ acks that alert")
    }

    /// "Turn off Screen Time" → dialog → Off (chip "Off", rules kept, promo stays away)
    /// → "Turn Screen Time back on". Off needs an enrolled device (fixture hook).
    func testParentTurnsScreenTimeOffAndBackOn() {
        resetScreenTime()
        XCTAssertEqual(post("/api/screen-time/kids/\(leo)/policy", ["enabled": true,
            "limits": [["id": "total", "kind": "total", "name": "Screen time", "minutesPerDay": 120, "weekendMinutes": 120]],
            "downtime": [["id": "bedtime", "name": "Bedtime", "start": "21:00", "end": "07:00", "days": [1, 2, 3, 4, 5, 6, 7]]]],
            role: .parent, method: "PUT"), 200)
        XCTAssertEqual(post("/__qa/screen-time/device", ["kidId": leo, "finishSetup": true], role: .parent), 200)

        let app = launch(.parent)
        let row = waitForStatus("Leo Visual", beginsWith: "On", in: app)
        XCTAssertFalse(app.descendants(matching: .any)["screentime.promo"].exists)
        reveal(row, app)
        row.tap()

        XCTAssertTrue(app.buttons["screentime.controls.done"].firstMatch.waitForExistence(timeout: 8))
        // The turn-off row is the last Basic row; List cells below the fold only exist once scrolled to.
        let turnOff = app.buttons["screentime.turnOff"].firstMatch
        if UIDevice.current.userInterfaceIdiom == .phone {
            XCTAssertFalse(app.descendants(matching: .any)["screentime.controls.sidebar"].exists,
                           "iPhone keeps the large sheet, no sidebar")
        }
        reveal(turnOff, app)
        turnOff.tap()
        let confirm = app.buttons["Turn off"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 4))
        XCTAssertTrue(app.staticTexts["Turn off Screen Time for Leo Visual?"].exists)
        attach("parent-turn-off-dialog")
        confirm.tap()

        let turnOn = app.buttons["screentime.turnOn"].firstMatch
        XCTAssertTrue(turnOn.waitForExistence(timeout: 8))
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Off. Bedtime'")).firstMatch.exists)
        XCTAssertFalse(app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch.exists,
                       "Off replaces the Basic switches")
        attach("parent-off")
        app.buttons["screentime.controls.done"].firstMatch.tap()

        let off = expectation(for: NSPredicate(format: "value == 'Off'"), evaluatedWith: row)
        wait(for: [off], timeout: 8)
        XCTAssertFalse(app.descendants(matching: .any)["screentime.promo"].exists, "Off never brings the promo back")
        attach("parent-today-off")

        reveal(row, app)
        row.tap()
        XCTAssertTrue(turnOn.waitForExistence(timeout: 8))
        reveal(turnOn, app)
        turnOn.tap()
        XCTAssertTrue(app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
            .waitForExistence(timeout: 8), "Back on: the Basic switches return with the saved rules")
        reveal(app.buttons["screentime.turnOff"].firstMatch, app)
        attach("parent-back-on")
    }

    /// iPad Pro 13-inch: the controls fill the window (not a form sheet) with a kid sidebar.
    func testParentControlsFillTheIPadWithKidSidebar() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "Run on the iPad Pro 13-inch destination")
        resetScreenTime()
        let app = launch(.parent)
        let row = app.descendants(matching: .any)["Leo Visual, Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 12))
        reveal(row, app)
        row.tap()

        let sidebar = app.descendants(matching: .any)["screentime.controls.sidebar"].firstMatch
        XCTAssertTrue(sidebar.waitForExistence(timeout: 8), "Regular width shows the kid sidebar")
        let window = app.windows.firstMatch.frame
        XCTAssertLessThanOrEqual(sidebar.frame.minX, window.minX + 1, "Full screen, not a centred form sheet")
        let done = app.buttons["screentime.controls.done"].firstMatch
        XCTAssertTrue(done.exists)
        XCTAssertGreaterThan(done.frame.maxX, window.maxX - 120)
        let maya = app.descendants(matching: .any)["screentime.controls.kid.qa-visual-kid-1"].firstMatch
        XCTAssertTrue(maya.exists)
        XCTAssertTrue(app.descendants(matching: .any)["screentime.controls.kid.\(leo)"].exists)
        attach("parent-ipad-controls")
        maya.tap()
        XCTAssertTrue(app.navigationBars["Screen Time for Maya Visual"].waitForExistence(timeout: 4)
                      || app.staticTexts["Screen Time for Maya Visual"].waitForExistence(timeout: 2))
        attach("parent-ipad-controls-maya")
        done.tap()
        XCTAssertTrue(sidebar.waitForNonExistence(timeout: 4))
    }

    /// Waits until the Today card row for `kidName` reports a status (i.e. the overview loaded).
    @discardableResult
    private func waitForStatus(_ kidName: String, beginsWith prefix: String, in app: XCUIApplication) -> XCUIElement {
        let row = app.descendants(matching: .any)["\(kidName), Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 12))
        let loaded = expectation(for: NSPredicate(format: "value BEGINSWITH %@", prefix), evaluatedWith: row)
        wait(for: [loaded], timeout: 12)
        return row
    }

    /// Unacked alerts the fixture holds for `kidId` (-1 when unreachable).
    private func openAlertCount(_ kidId: String) -> Int {
        var request = URLRequest(url: fixtureURL.appendingPathComponent("api/screen-time"))
        request.setValue("fam_sess=parent; fam_qa_scenario=family-rings", forHTTPHeaderField: "Cookie")
        let done = expectation(description: "overview"); var count = -1
        URLSession.shared.dataTask(with: request) { data, _, _ in
            let root = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
            let kids = root?["kids"] as? [[String: Any]] ?? []
            if let kid = kids.first(where: { $0["kidId"] as? String == kidId }) {
                let alerts = kid["alerts"] as? [[String: Any]] ?? []
                count = alerts.filter { $0["ackedAt"] == nil || $0["ackedAt"] is NSNull }.count
            }
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        return count
    }

    /// Wipes the synthetic family's Screen Time state (fixture-only hook).
    private func resetScreenTime() {
        XCTAssertEqual(post("/__qa/screen-time/reset", [:], role: .parent), 200)
    }

    @discardableResult
    private func post(_ path: String, _ body: [String: Any], role: Role, method: String = "POST") -> Int {
        var request = URLRequest(url: fixtureURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("fam_sess=\(role.rawValue); fam_qa_scenario=family-rings", forHTTPHeaderField: "Cookie")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        let done = expectation(description: path); var status = 0
        URLSession.shared.dataTask(with: request) { _, response, _ in
            status = (response as? HTTPURLResponse)?.statusCode ?? 0; done.fulfill()
        }.resume()
        wait(for: [done], timeout: 10)
        return status
    }

    private enum Role: String { case parent, kid }
    private func launch(_ role: Role) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = "light"
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = "fam_sess=\(role.rawValue); fam_qa_scenario=family-rings"
        app.launch()
        return app
    }
    private func reveal(_ element: XCUIElement, _ app: XCUIApplication) {
        for _ in 0..<14 where !(element.exists && element.isHittable) { app.swipeUp() }
        XCTAssertTrue(element.isHittable)
    }
    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "SYNTHETIC QA — \(name)"; shot.lifetime = .keepAlways; add(shot)
    }
}
