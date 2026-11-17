import Foundation

public struct TomorrowItem: Equatable {
    public let title: String
    public let time: String?

    public init(title: String, time: String? = nil) {
        self.title = title
        self.time = time
    }
}

public struct CalmTodayResult: Equatable {
    public let greeting: String
    public let calmLine: String?
    public let tomorrowLine: String?

    public init(greeting: String, calmLine: String?, tomorrowLine: String?) {
        self.greeting = greeting
        self.calmLine = calmLine
        self.tomorrowLine = tomorrowLine
    }
}

public enum TodayCalmCopy {
    public static func calmToday(
        now: Date = Date(),
        needsYouCount: Int = 0,
        tomorrowItems: [TomorrowItem] = [],
        calendar: Calendar = .current
    ) -> CalmTodayResult {
        let hour = calendar.component(.hour, from: now)

        let greeting: String
        if hour < 12 {
            greeting = "Good morning"
        } else if hour < 17 {
            greeting = "Good afternoon"
        } else {
            greeting = "Good evening"
        }

        let calmLine: String?
        if needsYouCount == 0 {
            if hour < 17 {
                calmLine = "Nothing needs you right now."
            } else {
                calmLine = "Nothing needs you. Enjoy dinner."
            }
        } else {
            calmLine = nil
        }

        let tomorrowLine: String?
        if hour >= 20 && !tomorrowItems.isEmpty {
            let sorted = tomorrowItems.sorted { lhs, rhs in
                let tL = (lhs.time?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ? lhs.time!.trimmingCharacters(in: .whitespacesAndNewlines) : nil
                let tR = (rhs.time?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false) ? rhs.time!.trimmingCharacters(in: .whitespacesAndNewlines) : nil
                switch (tL, tR) {
                case let (l?, r?):
                    return l < r
                case (_?, nil):
                    return true
                case (nil, _?):
                    return false
                case (nil, nil):
                    return false
                }
            }

            let titles = sorted
                .map { $0.title.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }

            if titles.isEmpty {
                tomorrowLine = nil
            } else {
                let preview = Array(titles.prefix(2)).joined(separator: " · ")
                tomorrowLine = "Tomorrow: \(preview)"
            }
        } else {
            tomorrowLine = nil
        }

        return CalmTodayResult(greeting: greeting, calmLine: calmLine, tomorrowLine: tomorrowLine)
    }

    public static func greeting(for date: Date = Date(), calendar: Calendar = .current) -> String {
        calmToday(now: date, calendar: calendar).greeting
    }
}
