import SwiftUI
import WatchKit

/// Kids' watch palette from the approved brief (docs/design/kids-watch/BRIEF.md).
enum WatchMyListPalette {
    static let violet = Color(red: 185 / 255, green: 140 / 255, blue: 1)
    static let homework = Color(red: 1, green: 159 / 255, blue: 69 / 255)
    static let chore = Color(red: 47 / 255, green: 211 / 255, blue: 181 / 255)
    static let fams = Color(red: 245 / 255, green: 197 / 255, blue: 66 / 255)
    static let control = Color(red: 44 / 255, green: 44 / 255, blue: 49 / 255)
    static let secondary = Color(red: 142 / 255, green: 142 / 255, blue: 150 / 255)
    static let secondaryLight = Color(red: 181 / 255, green: 181 / 255, blue: 189 / 255)
    static let homeworkGround = Color(red: 31 / 255, green: 18 / 255, blue: 0)
    static let choreGround = Color(red: 0, green: 32 / 255, blue: 27 / 255)
}

struct WatchMyListRing: View {
    let done: Int
    let total: Int
    var color: Color = WatchMyListPalette.chore
    var lineWidth: CGFloat = 3

    var body: some View {
        let progress = total > 0 ? Double(done) / Double(total) : 0
        ZStack {
            Circle().stroke(color.opacity(0.25), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .accessibilityHidden(true)
    }
}

struct WatchFamsChip: View {
    let amount: Int
    var suffix: String = ""

    var body: some View {
        Text("+\(amount) Fams\(suffix)")
            .font(.system(.caption2, design: .rounded).weight(.heavy))
            .foregroundStyle(.black)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(WatchMyListPalette.fams))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Screens 6 and 7: full-screen homework / chore alarm. A strong haptic
/// repeats every ~4 s until a button is tapped.
struct WatchAlarmView: View {
    let alarm: WatchReminder
    let famsAmount: Int?
    let onPrimary: () -> Void
    let onSnooze: () -> Void
    @State private var acting = false

    private var isHomework: Bool { alarm.kind == .homework }
    private var accent: Color { isHomework ? WatchMyListPalette.homework : WatchMyListPalette.chore }

    private var heading: String {
        let base = isHomework ? "HOMEWORK TIME" : "CHORE TIME"
        return alarm.buzz > 1 ? "\(base) · \(Self.ordinal(alarm.buzz)) buzz" : base
    }

    static func ordinal(_ n: Int) -> String {
        let suffix: String
        switch (n % 10, n % 100) {
        case (_, 11...13): suffix = "th"
        case (1, _): suffix = "st"
        case (2, _): suffix = "nd"
        case (3, _): suffix = "rd"
        default: suffix = "th"
        }
        return "\(n)\(suffix)"
    }

    var body: some View {
        ZStack {
            (isHomework ? WatchMyListPalette.homeworkGround : WatchMyListPalette.choreGround)
                .ignoresSafeArea()
            ScrollView {
                VStack(spacing: 6) {
                    ZStack {
                        Circle().stroke(accent.opacity(0.35), lineWidth: 4)
                        Circle().stroke(accent, lineWidth: 4).padding(7).opacity(0.6)
                        Image(systemName: isHomework ? "book.fill" : "checklist")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundStyle(accent)
                    }
                    .frame(width: 54, height: 54)
                    .accessibilityHidden(true)
                    Text(heading)
                        .font(.system(.caption2, design: .rounded).weight(.black))
                        .foregroundStyle(accent)
                        .multilineTextAlignment(.center)
                    Text(alarm.title.isEmpty ? (isHomework ? "Homework" : "Chore") : alarm.title)
                        .font(.system(.headline, design: .rounded).weight(.heavy))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if isHomework {
                        Text("Due \(alarm.occurrence.formatted(date: .omitted, time: .shortened))")
                            .font(.system(.footnote, design: .rounded).weight(.semibold))
                            .foregroundStyle(WatchMyListPalette.secondaryLight)
                    }
                    if let famsAmount, famsAmount > 0 { WatchFamsChip(amount: famsAmount) }
                    Button {
                        guard !acting else { return }
                        acting = true
                        onPrimary()
                    } label: {
                        Label(isHomework ? "Start" : "Done", systemImage: isHomework ? "play.fill" : "checkmark")
                            .font(.system(.body, design: .rounded).weight(.heavy))
                            .foregroundStyle(.black)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .background(Capsule().fill(accent))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 4)
                    .accessibilityHint(isHomework ? "Stops the buzz and opens the homework." : "Marks the chore done.")
                    if alarm.snoozesLeft > 0 {
                        Button {
                            guard !acting else { return }
                            acting = true
                            onSnooze()
                        } label: {
                            Text(isHomework ? "5 min" : "Later (\(alarm.snoozesLeft) left)")
                                .font(.system(.footnote, design: .rounded).weight(.bold))
                                .foregroundStyle(.white)
                                .frame(maxWidth: .infinity, minHeight: 38)
                                .background(Capsule().fill(WatchMyListPalette.control))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remind me in 5 minutes")
                        .accessibilityValue("\(alarm.snoozesLeft) left")
                    }
                }
                .padding(.horizontal, 6)
            }
        }
        .fontDesign(.rounded)
        .task(id: alarm.seriesID + String(alarm.buzz)) {
            // Strong buzz until a button is tapped (the view leaves on tap).
            while !Task.isCancelled && !acting {
                WKInterfaceDevice.current().play(.notification)
                do { try await Task.sleep(for: .milliseconds(700)) } catch { return }
                WKInterfaceDevice.current().play(.retry)
                do { try await Task.sleep(for: .seconds(3.3)) } catch { return }
            }
        }
    }
}

/// Screen 9: done, with progress, Fams note and the next item.
struct WatchDoneView: View {
    let summary: WatchDoneSummary
    let onNext: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                ZStack {
                    WatchMyListRing(done: summary.done, total: summary.total, lineWidth: 6)
                    Image(systemName: "checkmark")
                        .font(.system(size: 28, weight: .black))
                        .foregroundStyle(WatchMyListPalette.chore)
                }
                .frame(width: 66, height: 66)
                Text("Nice one!")
                    .font(.system(.title3, design: .rounded).weight(.black))
                Text(summary.title)
                    .font(.system(.footnote, design: .rounded).weight(.semibold))
                    .foregroundStyle(WatchMyListPalette.secondaryLight)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                Text("\(summary.done) of \(summary.total)")
                    .font(.system(.caption, design: .rounded).weight(.heavy))
                    .foregroundStyle(WatchMyListPalette.chore)
                if let fams = summary.famsAmount, fams > 0 {
                    WatchFamsChip(amount: fams, suffix: " when \(summary.approver) OKs")
                        .multilineTextAlignment(.center)
                }
                Button(action: onNext) {
                    Text(summary.next.map { "Next: \($0)" } ?? "All done for today")
                        .font(.system(.footnote, design: .rounded).weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .background(Capsule().fill(WatchMyListPalette.control))
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
            }
            .padding(.horizontal, 6)
        }
        .fontDesign(.rounded)
        .accessibilityElement(children: .contain)
    }
}

/// Root-level host for the alarm, the homework it starts, and the Done screen.
struct WatchAlarmHost: View {
    @EnvironmentObject private var store: WatchStore
    @ObservedObject private var center = WatchAlarmCenter.shared

    var body: some View {
        switch center.presentation {
        case .alarm(let alarm):
            WatchAlarmView(alarm: alarm, famsAmount: center.famsAmount(for: alarm)) {
                Task {
                    if alarm.kind == .homework { await center.start(alarm) } else { await center.done(alarm) }
                    WKInterfaceDevice.current().play(.success)
                }
            } onSnooze: {
                Task { await center.snooze(alarm) }
            }
            .id(alarm.seriesID)
        case .homework(let id):
            NavigationStack {
                Group {
                    if let work = store.snapshot.homework.first(where: { $0.id == id }) {
                        HomeworkDetailView(item: work)
                    } else {
                        Text("This homework is no longer on the watch.").padding()
                    }
                }
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close", systemImage: "xmark") { center.dismiss() }
                    }
                }
            }
        case .done(let summary):
            WatchDoneView(summary: summary) { center.dismiss() }
        case nil:
            Color.black
        }
    }
}
