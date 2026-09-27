import XCTest

/// Parent Screen Time promo → full-screen welcome → parent sheet, against the
/// synthetic fixture (tests/fixtures/ios-family-assistance-server.js, port 18247).
/// Start the fixture before running. The promo shows only while no kid has ever
/// set Screen Time up (`policy.version == 0`, docs/SCREEN-TIME-UX.md §1), so
/// setUp wipes the family's Screen Time state with the fixture's
/// `POST /__qa/screen-time/reset` hook (turning kids off would not bring it back).
final class ScreenTimePromoUITests: XCTestCase {
    private let fixtureURL = URL(string: "http://127.0.0.1:18247")!
    private let cookie = "fam_sess=parent; fam_qa_scenario=family-rings"

    override func setUp() async throws {
        continueAfterFailure = false
        let reset = try await send("__qa/screen-time/reset", method: "POST")
        XCTAssertEqual(reset, 200)
        var get = URLRequest(url: fixtureURL.appendingPathComponent("api/screen-time"))
        get.setValue(cookie, forHTTPHeaderField: "Cookie")
        let (data, _) = try await URLSession.shared.data(for: get)
        let kids = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["kids"] as? [[String: Any]] ?? []
        XCTAssertFalse(kids.isEmpty, "fixture returned no Screen Time kids")
        for kid in kids {
            let version = (kid["policy"] as? [String: Any])?["version"] as? Int
            XCTAssertEqual(version, 0, "reset should leave every kid never set up")
        }
    }

    @MainActor
    func testPromoOpensWelcomeAndSetsUpFirstKid() {
        let app = launchParent()

        // Promo is at the top of Today, visible without scrolling.
        let promo = app.descendants(matching: .any)["screentime.promo"].firstMatch
        XCTAssertTrue(promo.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["New: Screen Time that kids agree to"].exists)
        XCTAssertTrue(app.buttons["screentime.promo.notNow"].exists)
        let open = app.buttons["screentime.promo.open"]
        XCTAssertTrue(open.isHittable)
        XCTAssertLessThan(promo.frame.minY, app.frame.height / 2)
        attach("promo")
        open.tap()

        XCTAssertTrue(app.descendants(matching: .any)["screentime.welcome"].waitForExistence(timeout: 6))
        let titles = ["Two simple rules", "A deal, not a lock", "Family Sharing or not", "Three easy steps"]
        for (i, title) in titles.enumerated() {
            waitHittable(app.staticTexts[title])
            XCTAssertTrue(app.otherElements["Page \(i + 1) of 4"].exists || app.descendants(matching: .any)["Page \(i + 1) of 4"].exists)
            attach("welcome-\(i + 1)")
            if i < titles.count - 1 { app.buttons["Next"].tap() }
        }
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format:
            "label CONTAINS[c] 'token' OR label CONTAINS[c] 'authoriz' OR label CONTAINS[c] 'enroll' OR label CONTAINS[c] 'policy' OR label CONTAINS[c] 'cooperative' OR label CONTAINS[c] 'categor'"
        )).firstMatch.exists)

        let setup = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'screentime.welcome.setup.'")).firstMatch
        waitHittable(setup)
        XCTAssertTrue(setup.label.hasPrefix("Set up for "), setup.label)
        let kidName = String(setup.label.dropFirst("Set up for ".count))
        setup.tap()

        let bedtime = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Bedtime'")).firstMatch
        XCTAssertTrue(bedtime.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Screen Time for \(kidName)"].exists || app.navigationBars["Screen Time for \(kidName)"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["screentime.welcome"].exists)
        attach("parent-sheet")
    }

    /// The owner's case: a kid set up on a device and then turned off must not bring the
    /// promo back (the other kid was never set up).
    @MainActor
    func testPromoStaysAwayOnceAKidWasSetUpAndTurnedOff() async throws {
        let kid = "qa-visual-kid-1"
        let lists = #""limits":[],"downtime":[{"id":"bedtime","name":"Bedtime","start":"21:00","end":"07:00","days":[1,2,3,4,5,6,7]}]"#
        let on = try await send("api/screen-time/kids/\(kid)/policy", method: "PUT", body: #"{"enabled":true,\#(lists)}"#)
        XCTAssertEqual(on, 200)
        let device = try await send("__qa/screen-time/device", method: "POST", body: #"{"kidId":"qa-visual-kid-1"}"#)
        XCTAssertEqual(device, 200)
        let off = try await send("api/screen-time/kids/\(kid)/policy", method: "PUT", body: #"{"enabled":false,\#(lists)}"#)
        XCTAssertEqual(off, 200)

        let app = launchParent()
        let row = app.descendants(matching: .any)["Maya Visual, Screen Time"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        // "Off" needs the overview, so the promo decision has been made by now.
        let loaded = expectation(for: NSPredicate(format: "value == 'Off'"), evaluatedWith: row)
        await fulfillment(of: [loaded], timeout: 10)
        XCTAssertFalse(app.descendants(matching: .any)["screentime.promo"].exists)
        attach("promo-absent-after-off")
    }

    @MainActor
    private func launchParent() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["FAM_BASE_URL"] = fixtureURL.absoluteString
        app.launchEnvironment["FAM_ONBOARDED"] = "1"
        app.launchEnvironment["FAM_THEME"] = "light"
        app.launchEnvironment["FAM_SCREEN"] = "today"
        app.launchEnvironment["FAM_DEV_COOKIE"] = cookie
        // Clear any "Not now" snooze from earlier runs (argument domain beats stored defaults).
        app.launchArguments += ["-fam_st_promo_snoozed_until", "0"]
        app.launch()
        return app
    }

    private func send(_ path: String, method: String, body: String = "{}") async throws -> Int {
        var request = URLRequest(url: fixtureURL.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(body.utf8)
        let (_, response) = try await URLSession.shared.data(for: request)
        return (response as? HTTPURLResponse)?.statusCode ?? 0
    }

    private func waitHittable(_ element: XCUIElement, timeout: TimeInterval = 6) {
        let hittable = expectation(for: NSPredicate(format: "exists == true AND isHittable == true"), evaluatedWith: element)
        wait(for: [hittable], timeout: timeout)
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "SYNTHETIC QA — \(name)"; shot.lifetime = .keepAlways; add(shot)
    }
}
