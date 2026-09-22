import Foundation
import WidgetKit

struct FamilyAssistanceBuildInput {
    let user: User
    let family: Family
    let schoolEvents: Result<[CalendarEvent], Error>
    let familyEvents: Result<[FamilyEvent], Error>
    let homework: Result<[HomeworkItem], Error>
    let dailyFive: [String: Result<FamilyChildInsightSnapshot, Error>]
}

enum FamilyAssistanceSnapshotBuilder {
    static func build(input: FamilyAssistanceBuildInput, now: Date = Date(), calendar: Calendar = .current) -> FamilyAssistanceSnapshot? {
        guard input.user.role != "kid", input.family.parentIds.contains(input.user.id) else { return nil }
        let today = dayKey(now, calendar: calendar)
        let tomorrow = dayKey(calendar.date(byAdding: .day, value: 1, to: now) ?? now, calendar: calendar)

        let school = try? input.schoolEvents.get()
        let manual = try? input.familyEvents.get()
        let homework = try? input.homework.get()
        let calendarAvailable = school != nil && manual != nil
        let homeworkAvailable = homework != nil

        let children = input.family.kids.map { kid in
            let activities = activityItems(kidID: kid.id, school: school ?? [], manual: manual ?? [], now: now, calendar: calendar)
            let assignments = (homework ?? [])
                .filter { $0.kidId == kid.id && !$0.isDone }
                .map { homeworkItem($0, calendar: calendar) }
                .sorted(by: itemOrder)
            let dailyResult = input.dailyFive[kid.id]
            let insight = try? dailyResult?.get()
            let todayActivities = activities.filter { $0.dateKey == today }
            let tomorrowActivities = activities.filter { $0.dateKey == tomorrow }
            // The small projection must not let a backlog of old work hide an
            // assignment actually due today. Keep due-today rows first, then
            // the most recent overdue rows; the total count still covers all.
            let dueTodayHomework = assignments.filter { $0.dateKey == today }
            let overdueHomework = assignments.filter { $0.dateKey < today }.sorted {
                if $0.dateKey != $1.dateKey { return $0.dateKey > $1.dateKey }
                return itemOrder($0, $1)
            }
            let todayHomework = dueTodayHomework + overdueHomework
            let tomorrowHomework = assignments.filter { $0.dateKey == tomorrow }
            return FamilyAssistanceChild(
                id: kid.id,
                name: sanitized(kid.name, fallback: "Child"),
                colorHex: validHex(kid.color),
                nextActivity: calendarAvailable ? activities.first : nil,
                todayActivities: calendarAvailable ? Array(todayActivities.prefix(3)) : [],
                tomorrowActivities: calendarAvailable ? Array(tomorrowActivities.prefix(3)) : [],
                todayHomework: homeworkAvailable ? Array(todayHomework.prefix(3)) : [],
                tomorrowHomework: homeworkAvailable ? Array(tomorrowHomework.prefix(3)) : [],
                todayActivityCount: calendarAvailable ? todayActivities.count : 0,
                tomorrowActivityCount: calendarAvailable ? tomorrowActivities.count : 0,
                todayHomeworkCount: homeworkAvailable ? todayHomework.count : 0,
                tomorrowHomeworkCount: homeworkAvailable ? tomorrowHomework.count : 0,
                dailyFive: insight?.dailyFive,
                expectedHomeTime: insight?.expectedHomeTime,
                calendarAvailable: calendarAvailable,
                homeworkAvailable: homeworkAvailable,
                dailyFiveAvailable: dailyResult.flatMap { try? $0.get() } != nil
            )
        }
        return FamilyAssistanceSnapshot(
            accountID: input.user.id,
            familyID: input.family.id,
            generatedAt: now,
            expiresAt: min(now.addingTimeInterval(FamilyAssistanceSnapshot.maximumAge),
                calendar.startOfDay(for: calendar.date(byAdding: .day, value: 1, to: now) ?? now)),
            dayKey: today,
            timeZoneIdentifier: calendar.timeZone.identifier,
            children: children
        )
    }

    private static func activityItems(kidID: String, school: [CalendarEvent], manual: [FamilyEvent], now: Date, calendar: Calendar) -> [FamilyAssistanceItem] {
        let today = dayKey(now, calendar: calendar)
        let limit = dayKey(calendar.date(byAdding: .day, value: 7, to: now) ?? now, calendar: calendar)
        let schoolItems = school.compactMap { event -> FamilyAssistanceItem? in
            guard event.kidId == nil || event.kidId == kidID,
                  let start = event.start, start.count >= 10 else { return nil }
            let date = event.allDay == true
                ? dateTime(day: String(start.prefix(10)), time: nil, calendar: calendar)
                : parseISO(start)
            guard let date else { return nil }
            let key = dayKey(date, calendar: calendar)
            guard key >= today && key <= limit else { return nil }
            if event.allDay != true, date < now { return nil }
            return FamilyAssistanceItem(id: "school:\(event.id)", kind: .activity,
                title: sanitized(event.title, fallback: "School activity"), dateKey: key,
                startsAt: date, timeText: (event.allDay == true ? nil : timeText(date)))
        }
        let manualItems = manual.compactMap { event -> FamilyAssistanceItem? in
            guard event.kidId == nil || event.kidId == kidID,
                  event.date >= today, event.date <= limit else { return nil }
            let date = dateTime(day: event.date, time: event.time, calendar: calendar)
            if event.time != nil, let date, date < now { return nil }
            return FamilyAssistanceItem(id: "event:\(event.id):\(event.date)", kind: .activity,
                title: sanitized(event.title, fallback: "Family activity"), dateKey: event.date,
                startsAt: date, timeText: event.time.flatMap(displayTime))
        }
        return (schoolItems + manualItems).sorted(by: itemOrder)
    }

    private static func homeworkItem(_ item: HomeworkItem, calendar: Calendar) -> FamilyAssistanceItem {
        FamilyAssistanceItem(id: "homework:\(item.id)", kind: .homework,
            title: sanitized(item.title, fallback: "Homework"), dateKey: item.dueDate,
            startsAt: dateTime(day: item.dueDate, time: item.dueTime, calendar: calendar),
            timeText: item.dueTime.flatMap(displayTime))
    }

    private static func itemOrder(_ lhs: FamilyAssistanceItem, _ rhs: FamilyAssistanceItem) -> Bool {
        if lhs.dateKey != rhs.dateKey { return lhs.dateKey < rhs.dateKey }
        let lhsDate = lhs.startsAt ?? .distantFuture
        let rhsDate = rhs.startsAt ?? .distantFuture
        if lhsDate != rhsDate { return lhsDate < rhsDate }
        let titleOrder = lhs.title.localizedCaseInsensitiveCompare(rhs.title)
        if titleOrder != .orderedSame { return titleOrder == .orderedAscending }
        return lhs.id < rhs.id
    }

    private static func dayKey(_ date: Date, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }

    private static func dateTime(day: String, time: String?, calendar: Calendar) -> Date? {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = time == nil ? "yyyy-MM-dd" : "yyyy-MM-dd HH:mm"
        return formatter.date(from: time.map { "\(day) \($0)" } ?? day)
    }

    private static func parseISO(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private static func timeText(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    private static func displayTime(_ value: String) -> String? {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.dateFormat = "HH:mm"
        return input.date(from: value).map(timeText)
    }

    private static func sanitized(_ value: String, fallback: String) -> String {
        let clean = value.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String((clean.isEmpty ? fallback : clean).prefix(120))
    }

    private static func validHex(_ value: String) -> String? {
        let candidate = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return candidate.range(of: #"^#[0-9a-fA-F]{6}$"#, options: .regularExpression) == nil ? nil : candidate
    }
}

@MainActor
enum ParentFamilyAssistancePublisher {
    private static var generation: UInt = 0

    /// Call after an authenticated parent refresh completes. Each source keeps
    /// its own availability bit, so a failed request can never look like an
    /// authoritative empty day.
    static func publish(from store: AppStore, now: Date = Date()) async {
        guard !store.needsAuth, let user = store.me, let family = store.family,
              user.role != "kid", family.parentIds.contains(user.id) else {
            clear()
            return
        }
        if let existing = FamilyAssistanceSnapshotStore.load(),
           existing.accountID != user.id || existing.familyID != family.id {
            // Remove the prior account before any request for the new account
            // starts. A slow or failed refresh must never leave old child data.
            clear()
        }
        generation &+= 1
        let publishGeneration = generation

        async let school = captured { try await APIClient.shared.calendarEvents() }
        async let manual = captured { try await APIClient.shared.familyEvents() }
        async let homework = captured { try await APIClient.shared.homework() }
        async let progress = loadDailyFive(for: family.kids, date: dayKey(now))
        let (schoolResult, manualResult, homeworkResult, progressResult) =
            await (school, manual, homework, progress)
        guard publishGeneration == generation else { return }
        if isUnauthenticated(schoolResult) || isUnauthenticated(manualResult) ||
            isUnauthenticated(homeworkResult) || progressResult.values.contains(where: isUnauthenticated) {
            clear(ifGeneration: publishGeneration)
            return
        }
        let input = FamilyAssistanceBuildInput(user: user, family: family,
            schoolEvents: schoolResult, familyEvents: manualResult,
            homework: homeworkResult, dailyFive: progressResult)
        guard let snapshot = FamilyAssistanceSnapshotBuilder.build(input: input, now: now),
              publishGeneration == generation,
              store.me?.id == snapshot.accountID, store.family?.id == snapshot.familyID,
              !store.needsAuth else {
            clear()
            return
        }
        FamilyAssistanceSnapshotStore.save(snapshot)
        WidgetCenter.shared.reloadTimelines(ofKind: "FamETCFamilyWidget")
    }

    static func clear() {
        generation &+= 1
        FamilyAssistanceSnapshotStore.clear()
        WidgetCenter.shared.reloadTimelines(ofKind: "FamETCFamilyWidget")
    }

    private static func clear(ifGeneration expected: UInt) {
        guard generation == expected else { return }
        clear()
    }

    private static func captured<T>(_ operation: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await operation()) }
        catch { return .failure(error) }
    }

    private static func isUnauthenticated<T>(_ result: Result<T, Error>) -> Bool {
        guard case .failure(let error) = result else { return false }
        if case APIError.unauthenticated = error { return true }
        return false
    }

    private static func loadDailyFive(for kids: [Kid], date: String) async -> [String: Result<FamilyChildInsightSnapshot, Error>] {
        await withTaskGroup(of: (String, Result<FamilyChildInsightSnapshot, Error>).self) { group in
            for kid in kids {
                group.addTask { (kid.id, await dailyFive(kidID: kid.id, date: date)) }
            }
            var results: [String: Result<FamilyChildInsightSnapshot, Error>] = [:]
            for await (id, result) in group { results[id] = result }
            return results
        }
    }

    private static func dailyFive(kidID: String, date: String) async -> Result<FamilyChildInsightSnapshot, Error> {
        do {
            let url = Config.baseURL.appendingPathComponent("api/children/\(kidID)/insights")
            var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "date", value: date)]
            var request = URLRequest(url: components.url!)
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            for (name, value) in Config.clientHeaders { request.setValue(value, forHTTPHeaderField: name) }
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
            if http.statusCode == 401 { throw APIError.unauthenticated }
            guard (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            return .success(try DailyFiveSnapshotDecoder.decodeInsights(data, expectedDate: date))
        } catch { return .failure(error) }
    }

    private static func dayKey(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

struct ChildInsightsPayload: Decodable {
    struct Daily: Decodable { let date: String; let parts: [String: Part] }
    struct Part: Decodable { let status: String }
    struct HomePlan: Decodable { let date: String; let homeTime: String? }
    let daily5: Daily
    let homePlan: HomePlan?
}

enum DailyFiveSnapshotDecoder {
    private static let allowedParts: Set<String> = ["news", "word", "puzzle", "bt", "quote"]
    private static let allowedStatuses: Set<String> = ["started", "completed"]

    static func decode(_ data: Data, expectedDate: String) throws -> FamilyDailyFiveProgress {
        try decodeInsights(data, expectedDate: expectedDate).dailyFive
    }

    static func decodeInsights(_ data: Data, expectedDate: String) throws -> FamilyChildInsightSnapshot {
        let payload = try JSONDecoder().decode(ChildInsightsPayload.self, from: data)
        guard payload.daily5.date == expectedDate,
              Set(payload.daily5.parts.keys).isSubset(of: allowedParts),
              payload.daily5.parts.values.allSatisfy({ allowedStatuses.contains($0.status) }) else {
            throw URLError(.cannotParseResponse)
        }
        if let plan = payload.homePlan {
            guard plan.date == expectedDate,
                  plan.homeTime == nil || plan.homeTime!.range(of: #"^(?:[01]\d|2[0-3]):[0-5]\d$"#,
                    options: .regularExpression) != nil else {
                throw URLError(.cannotParseResponse)
            }
        }
        let values = payload.daily5.parts.values
        let daily3Parts = ["news", "quote", "word"]
        let daily3Completed = daily3Parts.filter { payload.daily5.parts[$0]?.status == "completed" }.count
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        guard let date = ISO8601DateFormatter().date(from: expectedDate + "T12:00:00Z") else {
            throw URLError(.cannotParseResponse)
        }
        let challengeKey = [2, 3].contains(calendar.component(.weekday, from: date)) ? "bt" : "puzzle"
        let scheduledChallengeStatus = payload.daily5.parts[challengeKey]?.status ?? "ready"
        let progress = FamilyDailyFiveProgress(completed: values.filter { $0.status == "completed" }.count,
            started: values.filter { $0.status == "started" }.count, total: allowedParts.count,
            daily3Completed: daily3Completed, scheduledChallengeStatus: scheduledChallengeStatus)
        return FamilyChildInsightSnapshot(dailyFive: progress,
            expectedHomeTime: payload.homePlan?.homeTime.flatMap(displayTime))
    }

    private static func displayTime(_ value: String) -> String? {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.dateFormat = "HH:mm"
        return input.date(from: value)?.formatted(date: .omitted, time: .shortened)
    }
}
