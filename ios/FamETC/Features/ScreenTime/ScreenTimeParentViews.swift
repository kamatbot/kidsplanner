import SwiftUI
import FamilyControls

// Parent Screen Time UX (docs/SCREEN-TIME-PLAN.md "UX"). Simple first: the Basic
// part of the sheet is two switches (Bedtime, Daily screen time), Pause and new
// alerts, in plain words. Everything technical lives under Advanced.
// Remote actions are best-effort, so delivery is always shown as Pending vs
// Confirmed from each device's registration health, never assumed from the server.
// States, alerts, presentation and Off: docs/SCREEN-TIME-UX.md §1–§4, §6.

// MARK: - Shared formatting

enum ScreenTimeFormat {
    /// Well-known ids the Basic screen edits.
    static let totalID = "total"
    static let bedtimeID = "bedtime"
    static let everyDay = [1, 2, 3, 4, 5, 6, 7]

    static func date(_ value: String?) -> Date? { ScreenTimeSchedule.date(fromISO: value) }

    static func relative(_ date: Date?) -> String {
        guard let date else { return "never" }
        if Date().timeIntervalSince(date) < 60 { return "just now" }
        return date.formatted(.relative(presentation: .named, unitsStyle: .abbreviated))
    }

    static func clock(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }

    /// A time that can be from another day, so a stale alert never reads as brand new:
    /// same day → clock ("4:12 PM"); yesterday/tomorrow → "Yesterday 4:12 PM" /
    /// "Tomorrow 4:12 PM"; within 6 days either side → "Tue 4:12 PM"; else →
    /// "12 Sep, 4:12 PM" (locale-aware).
    static func moment(_ date: Date, now: Date = Date()) -> String {
        let cal = Calendar.current
        let clockPart = clock(date)
        let dayDiff = cal.dateComponents([.day], from: cal.startOfDay(for: now), to: cal.startOfDay(for: date)).day ?? 0
        switch dayDiff {
        case 0: return clockPart
        case -1: return "Yesterday \(clockPart)"
        case 1: return "Tomorrow \(clockPart)"
        default:
            if abs(dayDiff) <= 6 { return "\(date.formatted(.dateTime.weekday(.abbreviated))) \(clockPart)" }
            return "\(date.formatted(.dateTime.day().month(.abbreviated))), \(clockPart)"
        }
    }

    /// "Sat 9:12 PM" — when a device last checked in.
    static func checkIn(_ date: Date?) -> String {
        guard let date else { return "a while ago" }
        return date.formatted(.dateTime.weekday(.abbreviated).hour().minute())
    }

    /// "21:00" → "9:00 PM" in the user's locale.
    static func time(_ hhmm: String) -> String {
        guard let date = dateFromHHMM(hhmm) else { return hhmm }
        return clock(date)
    }

    static func dateFromHHMM(_ hhmm: String) -> Date? {
        let parts = hhmm.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        return Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date())
    }

    static func hhmm(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    /// 45 → "45 min", 120 → "2 h", 150 → "2 h 30 min".
    static func minutes(_ m: Int) -> String {
        if m < 60 { return "\(m) min" }
        let h = m / 60, r = m % 60
        return r == 0 ? "\(h) h" : "\(h) h \(r) min"
    }

    /// `Calendar.weekday` numbers (1 = Sunday) → "Every day" / "Weekdays" / "Mon, Wed".
    static func days(_ days: [Int]) -> String {
        let set = Set(days)
        if set.count == 7 { return "Every day" }
        if set == [2, 3, 4, 5, 6] { return "Weekdays" }
        if set == [1, 7] { return "Weekends" }
        if set.isEmpty { return "No days" }
        let symbols = Calendar.current.shortWeekdaySymbols
        return orderedWeekdays.filter(set.contains).map { symbols[$0 - 1] }.joined(separator: ", ")
    }

    /// Weekday numbers in the user's locale order (e.g. Mon…Sun in the UK).
    static var orderedWeekdays: [Int] {
        let first = Calendar.current.firstWeekday
        return (0..<7).map { (first - 1 + $0) % 7 + 1 }
    }

    static func summary(_ s: SelectionSummary?) -> String {
        guard let s, !s.isEmpty else { return "No apps chosen yet" }
        var parts: [String] = []
        if s.apps > 0 { parts.append("\(s.apps) app\(s.apps == 1 ? "" : "s")") }
        if s.categories > 0 { parts.append("\(s.categories) categor\(s.categories == 1 ? "y" : "ies")") }
        if s.webDomains > 0 { parts.append("\(s.webDomains) website\(s.webDomains == 1 ? "" : "s")") }
        return parts.joined(separator: ", ")
    }

    /// "2 h a day on school days, 3 h on weekends" / "1 h a day".
    static func allowance(_ limit: ScreenTimeLimit) -> String {
        let weekday = minutes(limit.minutesPerDay)
        guard let weekend = limit.weekendMinutes, weekend != limit.minutesPerDay else { return "\(weekday) a day" }
        return "\(weekday) a day on school days, \(minutes(weekend)) on weekends"
    }

    /// Kid-facing rule line: total → "2 h a day on school days, 3 h on weekends"; apps → "Games · 1 h a day".
    static func limitLine(_ limit: ScreenTimeLimit) -> String {
        limit.isTotal ? allowance(limit) : "\(limit.name) · \(allowance(limit))"
    }

    static func downtimeLine(_ d: ScreenTimeDowntime) -> String {
        "\(d.name) \(time(d.start))–\(time(d.end))"
    }

    static func pauseUntil(_ policy: ScreenTimePolicy?) -> Date? {
        guard let until = policy?.pauseUntilDate, until > Date() else { return nil }
        return until
    }

    /// The whole-device limit needs an "All Apps & Categories" selection picked
    /// on the kid's device; true while an enrolled device still lacks one.
    static func needsFinishSetup(_ state: ScreenTimeKidState) -> Bool {
        guard let total = state.policy.limits.first(where: \.isTotal), !state.devices.isEmpty else { return false }
        if let parentSummary = total.selectionSummary, !parentSummary.isEmpty { return false }
        return state.devices.contains { total.deviceSelections?[$0.id]?.isEmpty ?? true }
    }

    /// Devices worth deriving the kid's status from: when at least one device is `ok` and
    /// was seen in the last 7 days, an older/never-seen device (a reinstalled or replaced
    /// phone's ghost) is ignored so it can't keep the kid red forever. Otherwise every
    /// device still counts, so losing the kid's only device still surfaces.
    static func statusDevices(_ devices: [ScreenTimeDevice], now: Date = Date()) -> [ScreenTimeDevice] {
        let cutoff = now.addingTimeInterval(-7 * 24 * 3600)
        func isRecent(_ device: ScreenTimeDevice) -> Bool {
            guard let seen = date(device.lastSeenAt) else { return false }
            return seen >= cutoff
        }
        guard devices.contains(where: { $0.state == "ok" && isRecent($0) }) else { return devices }
        return devices.filter(isRecent)
    }

    /// "Mia asks for 15 more minutes", plus " · 5 fams" on the whole Fam ETC plan.
    /// The Screen Time plan has no fams (docs/SCREEN-TIME-ONLY-PLAN.md D3).
    static func moreTimeLine(name: String, minutes: Int, fams: Int, plan: ProductPlan) -> String {
        plan == .screenTime
            ? "\(name) asks for \(minutes) more minutes"
            : "\(name) asks for \(minutes) more minutes · \(fams) fams"
    }

    /// Minutes until the next 7 AM (server accepts 15–1440).
    static func minutesUntilMorning(now: Date = Date()) -> Int {
        let cal = Calendar.current
        let today7 = cal.date(bySettingHour: 7, minute: 0, second: 0, of: now) ?? now
        let next = today7 > now ? today7 : cal.date(byAdding: .day, value: 1, to: today7) ?? today7
        return min(1440, max(15, Int((next.timeIntervalSince(now) / 60).rounded(.up))))
    }

    static func deviceNames(_ devices: [ScreenTimeDevice], kidName: String) -> String {
        let labels = devices.map(\.label)
        guard let first = labels.first else { return "\(kidName)'s phone" }
        return labels.count == 1 ? "\(kidName)'s \(first)" : "\(kidName)'s \(labels.dropLast().joined(separator: ", ")) and \(labels.last!)"
    }
}

// MARK: - Kid status (Today chip)

/// One status per kid, derived only from server-reported state. Precedence follows
/// docs/SCREEN-TIME-UX.md §1 (first match wins). Downtime, limit reached and pending
/// delivery keep the "On" chip; the sheet shows them as sub-lines.
enum ScreenTimeKidStatus: Equatable {
    case notSetUp, off, waiting, finishSetup, family, cooperative, unverified, turnedOff(Date?), mayBeRemoved, notCheckingIn, paused(Date), pauseRequested(Date)

    init(state: ScreenTimeKidState?) {
        guard let state else { self = .notSetUp; return }
        let devices = state.devices
        // Off = the parent turned it off after a device was set up; rules and deal are kept.
        guard state.policy.enabled else { self = devices.isEmpty ? .notSetUp : .off; return }
        if devices.isEmpty { self = .waiting; return }
        let recent = ScreenTimeFormat.statusDevices(devices)
        if recent.contains(where: { $0.state == "revoked" || $0.authStatus == "denied" }) {
            let at = state.alerts.filter { $0.type == "revoked" }
                .compactMap { ScreenTimeFormat.date($0.at) }.max()
            self = .turnedOff(at)
            return
        }
        if recent.contains(where: { $0.state == "removed" }) { self = .mayBeRemoved; return }
        if recent.contains(where: { $0.state == "stale" }) { self = .notCheckingIn; return }
        if ScreenTimeFormat.needsFinishSetup(state) { self = .finishSetup; return }
        let confirmed = !recent.isEmpty && recent.allSatisfy { ScreenTimeEssentialsPresentation.confirmed($0, policy: state.policy) }
        if let until = ScreenTimeFormat.pauseUntil(state.policy) { self = confirmed ? .paused(until) : .pauseRequested(until); return }
        if !confirmed { self = .unverified; return }
        self = devices.contains(where: \.isFamily) ? .family : .cooperative
    }

    var text: String {
        switch self {
        case .notSetUp: return "Not set up"
        case .off: return "Off"
        case .waiting: return "Set up on their phone"
        case .finishSetup: return "Finish setup on their phone"
        case .family, .cooperative: return "Rules confirmed"
        case .unverified: return "Waiting to check device"
        case .turnedOff: return "Access needs reconnecting"
        case .mayBeRemoved, .notCheckingIn: return "Can't reach device"
        case .paused(let until): return "Paused until \(ScreenTimeFormat.moment(until))"
        case .pauseRequested(let until): return "Pause requested until \(ScreenTimeFormat.moment(until))"
        }
    }

    /// The Today card / sidebar chip: "Set up" instead of "Not set up".
    var chipText: String { self == .notSetUp ? "Set up" : text }

    var colors: (ink: Color, soft: Color) {
        switch self {
        case .notSetUp, .off: return (Palette.frInk2, Palette.frCard2)
        case .waiting, .finishSetup, .unverified, .pauseRequested: return (Palette.frFamsInk, Palette.frFamsSoft)
        case .family: return (Palette.frD3Ink, Palette.frD3Soft)
        case .cooperative, .paused: return (Palette.frYouInk, Palette.frYouSoft)
        case .turnedOff, .mayBeRemoved, .notCheckingIn: return (Palette.frFamsInk, Palette.frFamsSoft)
        }
    }
}

struct ScreenTimeChip: View {
    let text: String
    let ink: Color
    let soft: Color

    var body: some View {
        Text(text)
            .font(Typography.chip)
            .foregroundStyle(ink)
            .padding(.horizontal, Space.sm + 2)
            .padding(.vertical, 5)
            .background(soft, in: Capsule())
            .fixedSize(horizontal: false, vertical: true)
    }
}

extension ScreenTimeDevice {
    func applied(_ policy: ScreenTimePolicy) -> Bool { ScreenTimeEssentialsPresentation.confirmed(self, policy: policy) }

    var isFamily: Bool { mode == ScreenTimeMode.family.rawValue }

    var modeTitle: String { isFamily ? "With Family Sharing" : "Without Family Sharing" }

    var modeMeaning: String {
        isFamily
            ? "Strong: your child can't remove Fam ETC or turn Screen Time access off."
            : "Access can be changed in this device's Settings. Fam ETC can notify you when a device reports a change."
    }
}

// MARK: - Parent Today card

struct ScreenTimeSummaryCard: View {
    @Environment(AppStore.self) private var store
    @State private var sheetKid: SheetKid?
    private var service: ScreenTimeService { .shared }

    private struct SheetKid: Identifiable { let id: String }

    var body: some View {
        Group {
        if store.isParent, !store.kids.isEmpty {
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    HStack {
                        MicroLabel(text: "Screen Time")
                        Spacer()
                        Image(systemName: "hourglass")
                            .font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Palette.frInk2)
                            .accessibilityHidden(true)
                    }
                    ForEach(store.kids) { kid in
                        row(kid)
                    }
                }
            }
            .screenTimeControlsCover(item: $sheetKid) { ScreenTimeParentSheet(initialKidId: $0.id) }
            .onChange(of: store.me?.id) { _, _ in sheetKid = nil }
            .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { sheetKid = nil } }
        }
        }
        .modifier(ScreenTimeEssentialAppsDraftGuard())
    }

    private func row(_ kid: Kid) -> some View {
        let status = ScreenTimeKidStatus(state: service.state(for: kid.id))
        return Button {
            Haptics.selection()
            sheetKid = SheetKid(id: kid.id)
        } label: {
            HStack(spacing: Space.md) {
                KidProfileAvatar(kid: kid, size: 30)
                Text(kid.name)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                Spacer(minLength: Space.sm)
                ScreenTimeChip(text: status.chipText, ink: status.colors.ink, soft: status.colors.soft)
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.frInk3)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(kid.name), Screen Time")
        .accessibilityValue(status.text)
        .accessibilityHint(status == .notSetUp ? "Set up Screen Time for \(kid.name)" : "Opens Screen Time controls")
    }
}

// MARK: - App-wide parent alert banner

/// Top-inset banner on every tab (docs/SCREEN-TIME-UX.md §2 client rules). Every banner
/// is dismissable in one tap from where it is shown: the ✕ acks that alert (hidden right
/// away), or — for a "more time" request — hides that request's banner on this device
/// without declining it. "Review" always opens the parent controls for that kid.
struct ScreenTimeAlertBanner: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Request ids whose banner the parent hid on this device (comma-separated, newest last).
    @AppStorage("fam_st_hiddenRequestBanner") private var hiddenRequestBanner = ""
    private var service: ScreenTimeService { .shared }

    /// Newest first: unacked, bannerable, < 7 days, Screen Time on for that kid.
    private var alerts: [ScreenTimeAlert] { service.bannerAlerts }

    private var hiddenRequestIds: [String] {
        hiddenRequestBanner.split(separator: ",").map(String.init)
    }

    /// Waiting "more time" requests not hidden here, oldest first (first come, first answered).
    private var requests: [ScreenTimeRequest] {
        let hidden = Set(hiddenRequestIds)
        return service.pendingRequests.filter { !hidden.contains($0.id) }
    }

    var body: some View {
        if store.isParent, !store.needsAuth {
            VStack(spacing: 0) {
                if let request = requests.first { requestBanner(request, more: requests.count - 1) }
                if let alert = alerts.first { alertBanner(alert, more: alerts.count - 1) }
            }
            .animation(reduceMotion ? nil : Motion.snappy, value: requests.map(\.id))
        }
    }

    private func kidName(_ kidId: String) -> String? {
        store.kids.first { $0.id == kidId }?.name
    }

    private func review(_ kidId: String) {
        Haptics.selection()
        NotificationCenter.default.post(name: .famDeepLinkToScreenTime, object: nil, userInfo: ["kidId": kidId])
    }

    private func hideRequest(_ id: String) {
        Haptics.selection()
        let kept = hiddenRequestIds.filter { $0 != id } + [id]
        hiddenRequestBanner = kept.suffix(20).joined(separator: ",")
    }

    /// 44 pt ✕ on the leading edge of a banner.
    private func dismissButton(label: String, hint: String, identifier: String,
                               action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "xmark")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Palette.textSecond)
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityHint(hint)
        .accessibilityIdentifier(identifier)
    }

    private func reviewButton(ink: Color, fill: Color, hint: String, identifier: String,
                              action: @escaping () -> Void) -> some View {
        Button("Review", action: action)
            .font(Typography.caption.weight(.bold))
            .foregroundStyle(ink)
            .padding(.horizontal, Space.md)
            .frame(minHeight: 44)
            .background(fill, in: Capsule())
            .buttonStyle(.plain)
            .accessibilityHint(hint)
            .accessibilityIdentifier(identifier)
    }

    private func requestBanner(_ r: ScreenTimeRequest, more: Int) -> some View {
        let name = DealWords.firstName(kidName(r.kidId)) ?? "Your child"
        return HStack(spacing: Space.sm) {
            dismissButton(label: "Dismiss",
                          hint: "Hides this banner. The request still waits in Screen Time.",
                          identifier: "screentime.banner.request.dismiss") { hideRequest(r.id) }
            VStack(alignment: .leading, spacing: 2) {
                Text(ScreenTimeFormat.moreTimeLine(name: name, minutes: r.minutes, fams: r.fams, plan: store.productPlan))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                Text(more > 0 ? "⏱️ Screen Time · \(more) more" : "⏱️ Screen Time · \(ScreenTimeFormat.relative(ScreenTimeFormat.date(r.createdAt)))")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            Spacer(minLength: Space.sm)
            reviewButton(ink: Palette.frOnYou, fill: Palette.frYou,
                         hint: "Opens Screen Time for \(name) to approve or decline",
                         identifier: "screentime.banner.request.review") { review(r.kidId) }
        }
        .padding(.vertical, Space.md)
        .padding(.leading, Space.xs)
        .padding(.trailing, Space.md)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(Palette.frYou, lineWidth: 2)
        )
        .cardShadow()
        .padding(.horizontal, Space.md)
        .padding(.top, Space.sm)
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screentime.banner.request")
    }

    private func alertBanner(_ alert: ScreenTimeAlert, more: Int) -> some View {
        let tone: Color
        let icon: String
        switch alert.type {
        case "revoked", "removed", "stale", "check_needed":
            tone = Palette.frFamsInk; icon = "clock.badge.exclamationmark"
        default:
            tone = Palette.accent; icon = "hourglass"
        }
        let name = kidName(alert.kidId) ?? "this child"
        return HStack(spacing: Space.sm) {
            dismissButton(label: "Dismiss this alert", hint: "Marks it as seen",
                          identifier: "screentime.banner.dismiss") {
                Haptics.selection()
                Task { await service.ackAlert(kidId: alert.kidId, alertId: alert.id) }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(ScreenTimeEssentialsPresentation.neutralAlert(type: alert.type, kidName: name))
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: Space.xs) {
                    Image(systemName: icon)
                        .foregroundStyle(tone)
                        .accessibilityHidden(true)
                    Text(more > 0 ? "Screen Time · \(more) more" : "Screen Time · \(ScreenTimeFormat.relative(ScreenTimeFormat.date(alert.at)))")
                        .foregroundStyle(Palette.textSecond)
                }
                .font(Typography.caption)
            }
            Spacer(minLength: Space.sm)
            reviewButton(ink: Palette.onAccent, fill: Palette.accent,
                         hint: "Opens Screen Time for \(name)",
                         identifier: "screentime.banner.review") { review(alert.kidId) }
        }
        .padding(.vertical, Space.md)
        .padding(.leading, Space.xs)
        .padding(.trailing, Space.md)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Radius.card, style: .continuous)
                .strokeBorder(tone, lineWidth: 2)
        )
        .cardShadow()
        .padding(.horizontal, Space.md)
        .padding(.top, Space.sm)
        .transition(reduceMotion ? .opacity : .move(edge: .top).combined(with: .opacity))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("screentime.banner.alert")
    }
}

// MARK: - Parent sheet

/// The Basic switches, edited as a draft and saved together.
private struct BasicDraft: Equatable {
    var bedtimeOn = false
    var bedStart = "21:00"
    var bedEnd = "07:00"
    var totalOn = false
    var school = 120
    var weekend = 180

    init() {}

    init(_ policy: ScreenTimePolicy?) {
        if let bed = policy?.downtime.first(where: { $0.id == ScreenTimeFormat.bedtimeID }) {
            bedtimeOn = true; bedStart = bed.start; bedEnd = bed.end
        }
        if let total = policy?.limits.first(where: \.isTotal) {
            totalOn = true
            school = total.minutesPerDay
            weekend = total.weekendMinutes ?? total.minutesPerDay
        }
    }
}

struct ScreenTimeParentSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var kidId: String
    @State private var columns: NavigationSplitViewVisibility = .all
    /// Mirrors the embedded controls' "saving / sending" state so a swipe never closes mid-save.
    @State private var controlsBusy = false
    private var service: ScreenTimeService { .shared }

    init(initialKidId: String) {
        _kidId = State(initialValue: initialKidId)
    }

    private var kid: Kid? { store.kids.first { $0.id == kidId } }

    var body: some View {
        Group {
            if sizeClass == .regular {
                // iPad (regular width, presented full screen): kid sidebar + a readable
                // 720 pt detail column instead of a stretched phone column.
                NavigationSplitView(columnVisibility: $columns) {
                    kidSidebar
                } detail: {
                    controlsChrome(
                        controls
                            .frame(maxWidth: 720)
                            .frame(maxWidth: .infinity)
                            .background(ScreenBackground())
                    )
                }
                .navigationSplitViewStyle(.balanced)
            } else {
                NavigationStack {
                    controlsChrome(controls.background(ScreenBackground()))
                }
            }
        }
        // Swipe-down closes the compact sheet, except mid-save (covers ignore this).
        .interactiveDismissDisabled(controlsBusy)
        .onChange(of: store.me?.id) { _, _ in dismiss() }
        .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { dismiss() } }
    }

    /// The shared controls body; the compact sheet adds the segmented kid picker.
    private var controls: some View {
        ScreenTimeKidControls(selectedKidId: $kidId, showsKidPicker: sizeClass != .regular, isBusy: $controlsBusy)
    }

    /// Title + Done, shared by the compact stack and the regular detail column.
    private func controlsChrome(_ content: some View) -> some View {
        content
            .navigationTitle(kid.map { "Screen Time for \($0.name)" } ?? "Screen Time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }.accessibilityIdentifier("screentime.controls.done")
                }
            }
    }

    /// Regular width: the family's kids with their status chips; selection is `kidId`.
    private var kidSidebar: some View {
        List(selection: Binding<String?>(get: { kidId }, set: { if let id = $0 { kidId = id } })) {
            ForEach(store.kids) { kid in
                sidebarRow(kid).tag(kid.id)
            }
        }
        .navigationTitle("Screen Time")
        .navigationSplitViewColumnWidth(min: 260, ideal: 300, max: 360)
        .accessibilityIdentifier("screentime.controls.sidebar")
    }

    private func sidebarRow(_ kid: Kid) -> some View {
        let status = ScreenTimeKidStatus(state: service.state(for: kid.id))
        return HStack(spacing: Space.md) {
            KidProfileAvatar(kid: kid, size: 36)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text(kid.name)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                ScreenTimeChip(text: status.chipText, ink: status.colors.ink, soft: status.colors.soft)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, Space.xs)
        .frame(minHeight: 44)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(kid.name), Screen Time")
        .accessibilityValue(status.text)
        .accessibilityIdentifier("screentime.controls.kid.\(kid.id)")
    }
}

// MARK: - Kid controls (embeddable)

/// The Screen Time controls for one kid: Basic (bedtime, daily time, Save), status, the
/// per-device protection check, more-time requests, Pause, Turn off and Advanced. A plain
/// `List` with no chrome of its own, so the parent sheet (`ScreenTimeParentSheet`) and the
/// Screen Time plan's iPad Home detail embed exactly the same behaviour.
struct ScreenTimeKidControls: View {
    @Environment(AppStore.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let fixedKidId: String
    private let kidBinding: Binding<String>?
    private let showsKidPicker: Bool
    private let isBusy: Binding<Bool>?
    @State private var draft = BasicDraft()
    @State private var baseline = BasicDraft()
    @State private var loadedKey = ""
    @State private var error: String?
    @State private var working = false
    @State private var pausing = false
    @State private var justSaved = false
    @State private var showAdvanced = false
    @State private var showHow = false
    @State private var showProtectionDetails = false
    @State private var showEssentialApps = false
    @State private var editingLimit: ScreenTimeLimit?
    @State private var editingDowntime: ScreenTimeDowntime?
    @State private var forgetting: ScreenTimeDevice?
    @State private var moving: MoveTarget?
    @State private var showDeal = false
    @State private var deciding: String?
    @State private var requestError: String?
    @State private var confirmTurnOff = false
    @State private var checkingProtection = false
    @State private var checkRequestedAt: Date?
    @State private var deviceRefreshTask: Task<Void, Never>?
    @State private var essentialAction: EssentialAction?
    @State private var essentialBusy = false
    @State private var essentialError: String?
    @State private var usageError: String?
    @State private var usageToday: ScreenTimeUsageDay?
    private var service: ScreenTimeService { .shared }

    /// Embedded controls for one fixed kid (the Screen Time plan's iPad Home detail).
    /// Switching `kidId` keeps working: the controls reset their draft for the new kid.
    init(kidId: String) {
        fixedKidId = kidId
        kidBinding = nil
        showsKidPicker = false
        isBusy = nil
    }

    /// Controls that follow a selection owned by the host (the parent sheet), optionally with
    /// the compact segmented kid picker, reporting save/send activity through `isBusy`.
    init(selectedKidId: Binding<String>, showsKidPicker: Bool, isBusy: Binding<Bool>? = nil) {
        fixedKidId = selectedKidId.wrappedValue
        kidBinding = selectedKidId
        self.showsKidPicker = showsKidPicker
        self.isBusy = isBusy
    }

    private var kidId: String { kidBinding?.wrappedValue ?? fixedKidId }
    private var kidSelection: Binding<String> { kidBinding ?? .constant(fixedKidId) }
    /// Words for the kid's own screen, which the Screen Time plan makes their whole home.
    private var kidHome: String { store.productPlan == .screenTime ? "the home screen" : "Today" }
    /// No fams anywhere on the Screen Time plan (docs/SCREEN-TIME-ONLY-PLAN.md D3).
    private var noFams: Bool { store.productPlan == .screenTime }

    private var kid: Kid? { store.kids.first { $0.id == kidId } }
    private var kidName: String { kid?.name ?? "your child" }
    private var state: ScreenTimeKidState? { service.state(for: kidId) }
    private var policy: ScreenTimePolicy? { state?.policy }
    private var devices: [ScreenTimeDevice] { state?.devices ?? [] }
    /// This kid's siblings, to offer "Move to <name>" on a device row (only when 2+ kids).
    private var otherKids: [Kid] { store.kids.filter { $0.id != kidId } }
    private var appLimits: [ScreenTimeLimit] { policy?.limits.filter { !$0.isTotal } ?? [] }
    private var extraDowntime: [ScreenTimeDowntime] { policy?.downtime.filter { $0.id != ScreenTimeFormat.bedtimeID } ?? [] }
    /// Open alerts, newest first, minus the ones just dismissed with ✕ (ack in flight).
    private var unacked: [ScreenTimeAlert] {
        (state?.alerts ?? []).filter { $0.ackedAt == nil && !service.hiddenAlertIds.contains($0.id) }
            .sorted { (ScreenTimeFormat.date($0.at) ?? .distantPast) > (ScreenTimeFormat.date($1.at) ?? .distantPast) }
    }
    private var requests: [ScreenTimeRequest] {
        (state?.requests ?? []).sorted { ($0.createdAt ?? "") > ($1.createdAt ?? "") }
    }
    private var hasRules: Bool { !(policy?.limits.isEmpty ?? true) || !(policy?.downtime.isEmpty ?? true) }
    /// Screen Time is on for this kid (the parent can pause or turn it off).
    private var isOn: Bool { policy?.enabled == true }
    /// The parent turned it off with rules saved: the Basic switches give way to the Off
    /// section and "Turn Screen Time back on" (docs/SCREEN-TIME-UX.md §4).
    private var isOff: Bool { policy?.enabled == false && hasRules }

    var body: some View {
        controlsList
            .task(id: "\(kidId)|\(policy?.version ?? -1)") { syncDraft() }
            .task(id: kidId) { await loadUsage() }
            .onChange(of: kidId) { _, _ in
                deviceRefreshTask?.cancel(); deviceRefreshTask = nil
                error = nil; justSaved = false; requestError = nil
                checkRequestedAt = nil; essentialError = nil; essentialAction = nil
                showProtectionDetails = false; showEssentialApps = false
            }
            .onChange(of: store.me?.id) { _, _ in deviceRefreshTask?.cancel() }
            .onChange(of: store.needsAuth) { _, needsAuth in if needsAuth { deviceRefreshTask?.cancel() } }
            .onChange(of: working || pausing || essentialBusy) { _, busy in isBusy?.wrappedValue = busy }
            .onDisappear { deviceRefreshTask?.cancel(); isBusy?.wrappedValue = false }
            .sheet(isPresented: $showDeal) {
                if let deal = state?.agreement { ScreenTimeDealSheet(deal: deal, kidName: kidName) }
            }
            .sheet(item: $editingLimit) { limit in
                ScreenTimeLimitEditor(kidName: kidName, limit: limit,
                                      isNew: !appLimits.contains { $0.id == limit.id && !limit.id.isEmpty },
                                      devices: devices) { updated in
                    try await saveAdvancedLimit(replacing: limit.id, with: updated)
                }
            }
            .sheet(item: $editingDowntime) { d in
                ScreenTimeDowntimeEditor(downtime: d,
                                         isNew: !extraDowntime.contains { $0.id == d.id && !d.id.isEmpty }) { updated in
                    try await saveAdvancedDowntime(replacing: d.id, with: updated)
                }
            }
            .task { if service.overview == nil { await service.loadOverview() } }
    }

    private var controlsList: some View {
        ScrollViewReader { proxy in
        List {
            if showsKidPicker && store.kids.count > 1 {
                Section {
                    Picker("Child", selection: kidSelection) {
                        ForEach(store.kids) { Text($0.name).tag($0.id) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }
            }
            if state == nil {
                Section {
                    if service.overview == nil {
                        HStack(spacing: Space.sm) { ProgressView(); Text("Loading…").foregroundStyle(Palette.textSecond) }
                    } else {
                        Text("Screen Time for \(kidName) isn't available right now. Pull down to try again.")
                            .foregroundStyle(Palette.textSecond)
                    }
                }
            } else {
                if let error { errorSection(error) }
                if isOff {
                    offSection
                } else {
                    bedtimeSection
                    dailySection
                    saveSection
                    if devices.isEmpty { setupStepsSection }
                }
                statusSection
                if !devices.isEmpty {
                    protectionSection
                    perDeviceUsageSection
                    Section {
                        Button(showEssentialApps ? "Hide essential apps" : "Manage essential apps") {
                            showEssentialApps.toggle()
                        }
                        .frame(minHeight: 44)
                    }
                    if ScreenTimeEssentialsPresentation.showEssentialApps(devices: devices, expanded: showEssentialApps) {
                        essentialAppsSection
                    }
                }
                requestSection
                if isOn && !devices.isEmpty && hasRules { pauseSection }
                if isOn { turnOffSection }
                advancedToggle
                if showAdvanced {
                    limitsSection
                    downtimeSection
                    devicesSection
                    alertHistorySection
                    requestHistorySection
                    detailedUsageSection
                    howSection
                }
            }
        }
        .font(Typography.body)
        .scrollContentBackground(.hidden)
        .refreshable {
            await service.loadOverview()
            await loadUsage()
        }
        .confirmationDialog("Forget this device?", isPresented: Binding(
            get: { forgetting != nil }, set: { if !$0 { forgetting = nil } }
        ), titleVisibility: .visible, presenting: forgetting) { device in
            Button("Forget \(kidName)'s \(device.label)", role: .destructive) {
                run { try await service.forgetDevice(kidId: kidId, deviceId: device.id) }
            }
        } message: { _ in
            Text("Fam ETC stops tracking this device. Set it up again on the device to reconnect.")
        }
        .confirmationDialog("Move \(moving?.device.label ?? "device") to \(moving?.toKid.name ?? "")?", isPresented: Binding(
            get: { moving != nil }, set: { if !$0 { moving = nil } }
        ), titleVisibility: .visible, presenting: moving) { target in
            Button("Move") {
                run { try await service.moveDevice(kidId: kidId, deviceId: target.device.id, toKidId: target.toKid.id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { target in
            Text("It will follow \(target.toKid.name)'s Screen Time rules from its next check-in.")
        }
        .confirmationDialog(essentialAction?.title ?? "Essential apps", isPresented: Binding(
            get: { essentialAction != nil }, set: { if !$0 { essentialAction = nil } }
        ), titleVisibility: .visible, presenting: essentialAction) { action in
            Button(action.button, role: action.kind == .approve ? nil : .destructive) { performEssentialAction(action) }
            Button("Cancel", role: .cancel) {}
        } message: { action in
            Text(action.kind == .approve
                 ? "On \(kidName)'s \(action.device.label), open Essential apps and tap Review selected apps together before approving here. Counts don't identify the apps. These apps remain subject to daily limits and parent pauses."
                 : action.kind == .decline
                    ? "Decline this proposal? Any apps already approved are kept."
                    : "Remove approved essential apps and any waiting proposal from this device? Bedtime and quiet time will include these apps once the device confirms the change.")
        }
        .accessibilityIdentifier("screentime.controls")
        // Turning off happens at the bottom of a long list while the Off section replaces the
        // switches at the top; bring it into view so the parent sees the change land. No anchor:
        // only scrolls when the row is hidden, so opening an off kid keeps the kid picker.
        .onChange(of: isOff) { _, off in
            if off { withAnimation(Motion.maybe(Motion.gentle, reduceMotion: reduceMotion)) { proxy.scrollTo(Self.offRowID) } }
        }
        }
    }

    private static let offRowID = "screentime.off"

    /// Reload the Basic draft from the server policy unless the parent has unsaved edits
    /// for this kid (a kid switch always reloads).
    private func syncDraft() {
        let kidChanged = !loadedKey.hasPrefix("\(kidId)|")
        loadedKey = "\(kidId)|\(policy?.version ?? -1)"
        let fresh = BasicDraft(policy)
        if kidChanged || draft == baseline { draft = fresh }
        baseline = fresh
    }

    // MARK: Basic — status

    private var statusLine: (text: String, icon: String, tone: Color) {
        guard let state, hasRules else {
            return ("Screen Time is off for \(kidName). Turn on a switch below and tap Save.", "hourglass", Palette.frInk2)
        }
        if !state.policy.enabled { return (offSummary, "power", Palette.frInk2) }
        if devices.isEmpty {
            return ("Saved. Now set it up on \(kidName)'s phone.", "iphone", Palette.frFamsInk)
        }
        let recent = ScreenTimeFormat.statusDevices(devices)
        if recent.contains(where: { $0.state == "revoked" || $0.authStatus == "denied" }) {
            return ("Access needs reconnecting on \(kidName)'s device", "arrow.clockwise", Palette.frFamsInk)
        }
        if let d = recent.first(where: { $0.state == "removed" }) {
            return ("Can't reach \(kidName)'s \(d.label). It may be off or offline.", "clock", Palette.frFamsInk)
        }
        if let d = recent.first(where: { $0.state == "stale" }) {
            return ("Can't reach \(kidName)'s \(d.label). It may be off or offline.", "clock", Palette.frFamsInk)
        }
        if ScreenTimeFormat.needsFinishSetup(state) {
            return ("Finish setup on \(kidName)'s phone", "iphone", Palette.frFamsInk)
        }
        if let until = ScreenTimeFormat.pauseUntil(state.policy) {
            let confirmed = devices.allSatisfy { $0.applied(state.policy) }
            return ("\(confirmed ? "Pause confirmed" : "Pause requested") until \(ScreenTimeFormat.moment(until))", "pause.circle.fill", Palette.frYouInk)
        }
        if devices.contains(where: { !$0.applied(state.policy) }) {
            return ("Rules saved · waiting to check device", "clock.arrow.circlepath", Palette.frFamsInk)
        }
        return ("Rules confirmed on \(ScreenTimeFormat.deviceNames(devices, kidName: kidName))", "checkmark.shield.fill", Palette.frD3Ink)
    }

    /// "Off. Bedtime 9:00 PM–7:00 AM and 2 h a day are saved."
    private var offSummary: String {
        guard let policy else { return "Off." }
        var parts: [String] = []
        if let bed = policy.downtime.first(where: { $0.id == ScreenTimeFormat.bedtimeID }) {
            parts.append("Bedtime \(ScreenTimeFormat.time(bed.start))–\(ScreenTimeFormat.time(bed.end))")
        }
        if let total = policy.limits.first(where: \.isTotal) { parts.append(ScreenTimeFormat.allowance(total)) }
        if !appLimits.isEmpty || !extraDowntime.isEmpty { parts.append(parts.isEmpty ? "Your rules" : "your other rules") }
        guard let last = parts.last else { return "Off." }
        let list = parts.count == 1 ? last : parts.dropLast().joined(separator: ", ") + " and " + last
        let verb = parts.count == 1 && last != "Your rules" ? "is" : "are"
        return "Off. \(list) \(verb) saved."
    }

    /// On-state sub-lines (§1): "Bedtime now", "Daily time used up at 4:12 PM".
    private var liveSubLines: [String] {
        guard let state, state.policy.enabled else { return [] }
        switch ScreenTimeKidStatus(state: state) {
        case .family, .cooperative: break
        default: return []
        }
        var lines: [String] = []
        let now = Date()
        if let window = state.policy.downtime.first(where: {
            ScreenTimeSchedule.isInsideWindow(start: $0.start, end: $0.end, days: $0.days, now: now)
        }) {
            lines.append(window.id == ScreenTimeFormat.bedtimeID ? "Bedtime now" : "\(window.name) now")
        }
        // Usage and limit-reached evidence belong to each device, shown below.
        return lines
    }

    private var statusSection: some View {
        let line = statusLine
        return Section {
            Label {
                Text(line.text)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: line.icon).foregroundStyle(line.tone)
            }
            .accessibilityElement(children: .combine)
            if isOff, let policy, !devices.isEmpty { offDeliveryLine(policy) }
            ForEach(liveSubLines, id: \.self) { sub in
                Label(sub, systemImage: sub.hasPrefix("Daily") || sub.hasPrefix("Limit") ? "hourglass.bottomhalf.filled" : "moon.fill")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
                    .monospacedDigit()
            }
            if hasRules { dealRow }
            if let state, ScreenTimeFormat.needsFinishSetup(state) {
                Text("On \(kidName)'s device, open Fam ETC, tap “Finish setup” on \(kidHome), and follow the steps together.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
            }
            ForEach(unacked) { alert in
                HStack(alignment: .center, spacing: Space.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ScreenTimeEssentialsPresentation.neutralAlert(type: alert.type, kidName: kidName))
                            .font(Typography.body)
                            .foregroundStyle(Palette.text)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(ScreenTimeFormat.relative(ScreenTimeFormat.date(alert.at)))
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                    .accessibilityElement(children: .combine)
                    Spacer(minLength: Space.sm)
                    Button {
                        Haptics.selection()
                        Task { await service.ackAlert(kidId: alert.kidId, alertId: alert.id) }
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Palette.textSecond)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Dismiss this alert")
                    .accessibilityIdentifier("screentime.alert.dismiss")
                }
            }
            if !unacked.isEmpty {
                Button("Got it") {
                    Haptics.selection()
                    Task { await service.ackAlerts(kidId: kidId) }
                }
                .frame(minHeight: 44)
                .accessibilityHint("Marks these Screen Time alerts as seen")
            }
        }
    }

    private func loadUsage() async {
        let id = kidId
        let account = store.me?.id
        usageToday = nil
        usageError = nil
        do {
            let today = try await service.usage(kidId: id, days: 1).days.first
            if id == kidId && account == store.me?.id { usageToday = today }
        } catch {
            if id == kidId && account == store.me?.id { usageError = "Usage couldn't load. Try again when you're online." }
        }
    }

    private var protectionSection: some View {
        Section {
            ForEach(devices) { device in
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text(device.label).font(Typography.body.weight(.semibold))
                    Text(ScreenTimeEssentialsPresentation.protection(device, policy: policy ?? .disabled, after: checkRequestedAt))
                        .font(Typography.label.weight(.semibold))
                        .foregroundStyle(ScreenTimeEssentialsPresentation.confirmed(device, policy: policy ?? .disabled, after: checkRequestedAt) ? Palette.frD3Ink : Palette.frFamsInk)
                        .fixedSize(horizontal: false, vertical: true)
                    if let action = ScreenTimeEssentialsPresentation.nextAction(device, policy: policy ?? .disabled, after: checkRequestedAt) {
                        Text(action)
                            .font(Typography.label).foregroundStyle(Palette.textSecond)
                    }
                }
                .padding(.vertical, Space.xs)
                .accessibilityElement(children: .combine)
            }
            Button {
                requestProtectionCheck()
            } label: {
                HStack(spacing: Space.sm) {
                    if checkingProtection { ProgressView() }
                    Label(checkingProtection ? "Requesting check…" : "Check devices", systemImage: "arrow.clockwise")
                }
                .frame(minHeight: 44)
            }
            .disabled(checkingProtection)
            .accessibilityIdentifier("screentime.protection.check")
            if let requested = checkRequestedAt, let policy,
               devices.contains(where: { !ScreenTimeEssentialsPresentation.confirmed($0, policy: policy, after: requested) }) {
                Text("Check requested. Waiting for each device to respond. You can check again later.")
                    .font(Typography.label).foregroundStyle(Palette.frFamsInk)
                    .fixedSize(horizontal: false, vertical: true)
            }
            DisclosureGroup("Details", isExpanded: $showProtectionDetails) {
                ForEach(devices) { device in
                    VStack(alignment: .leading, spacing: Space.sm) {
                        Text(device.label).font(Typography.body.weight(.semibold))
                        checklistLine("Screen Time access", verified: device.authStatus == "approved")
                        checklistLine("Current rules registered", verified: device.applied(policy ?? .disabled))
                        checklistLine("Usage selection ready", verified: device.health?.hasUsageSelection == true)
                        if let health = device.health {
                            Text("Activities: \(health.registeredActivities) of \(health.expectedActivities) registered")
                                .font(Typography.caption).foregroundStyle(Palette.textSecond).monospacedDigit()
                            Text("Device check \(ScreenTimeFormat.relative(ScreenTimeFormat.date(health.checkedAt)))")
                                .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        }
                    }
                }
                Text("Saving a rule does not confirm it is ready. Each device must report that the current rules registered successfully.")
                    .font(Typography.caption).foregroundStyle(Palette.textSecond)
            }
            .accessibilityIdentifier("screentime.protection.details")
        } header: { Text("Your child's devices") }
    }

    private func checklistLine(_ title: String, verified: Bool) -> some View {
        Label("\(title) · \(verified ? "confirmed" : "needs check")", systemImage: verified ? "checkmark.circle" : "circle.dashed")
            .font(Typography.label)
            .foregroundStyle(verified ? Palette.frD3Ink : Palette.textSecond)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func requestProtectionCheck() {
        guard !checkingProtection else { return }
        let id = kidId
        let account = store.me?.id
        let requested = Date()
        checkingProtection = true
        error = nil
        checkRequestedAt = requested
        Task {
            do {
                try await service.checkProtection(kidId: id)
                if id == kidId && account == store.me?.id {
                    await loadUsage()
                    refreshAwaitingDevices(after: requested)
                }
            } catch {
                if id == kidId && account == store.me?.id {
                    self.error = "Couldn't request a device check. \(error.localizedDescription)"
                    checkRequestedAt = nil
                }
            }
            checkingProtection = false
        }
    }

    /// A short refresh window belongs only to an explicit save/check; waiting is persistent afterward.
    private func refreshAwaitingDevices(after requested: Date) {
        deviceRefreshTask?.cancel()
        guard !devices.isEmpty else { return }
        let id = kidId
        let account = store.me?.id
        deviceRefreshTask = Task { @MainActor in
            for delay in [3, 6, 10] {
                do { try await Task.sleep(for: .seconds(delay)) } catch { return }
                guard !Task.isCancelled, id == kidId, account == store.me?.id, !store.needsAuth else { return }
                await service.loadOverview()
                guard !Task.isCancelled, id == kidId, account == store.me?.id else { return }
                if let policy, !devices.isEmpty,
                   devices.allSatisfy({ ScreenTimeEssentialsPresentation.confirmed($0, policy: policy, after: requested) }) {
                    return
                }
            }
        }
    }

    private var perDeviceUsageSection: some View {
        Section {
            ForEach(devices) { device in
                let usage = usageToday?.date == ScreenTimeSchedule.dayString(Date())
                    ? usageToday?.devices?.first(where: { $0.deviceId == device.id }) : nil
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(device.label).font(Typography.body.weight(.semibold))
                    Text(ScreenTimeEssentialsPresentation.remaining(usage))
                        .font(Typography.label).monospacedDigit()
                    if let usage, let updated = ScreenTimeFormat.date(usage.updatedAt) {
                        Text("Last report \(ScreenTimeFormat.moment(updated))")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                    }
                    if let allowance = usage?.limitMinutes {
                        Text("Reported daily allowance: \(ScreenTimeFormat.minutes(allowance)) on this device")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                    }
                    if let reached = ScreenTimeFormat.date(usage?.limitReachedAt) {
                        Text("Limit reached on this device at \(ScreenTimeFormat.moment(reached))")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine)
            }
            if let usageError {
                Text(usageError).foregroundStyle(Palette.frDanger)
                Button("Retry usage") { Task { await loadUsage() } }.frame(minHeight: 44)
            }
            if let policy, policy.enabled {
                TimelineView(.everyMinute) { context in
                    ScreenTimeNextAccessView(policy: policy, now: context.date)
                }
            }
        } header: { Text("Time today, by device") }
        footer: { Text("Approximate usage is reported in 15-minute steps. Each device has its own daily allowance. Essential app exceptions do not bypass daily limits.") }
    }

    private enum EssentialActionKind { case approve, decline, remove }
    private struct EssentialAction: Identifiable {
        let kind: EssentialActionKind
        let device: ScreenTimeDevice
        let requestId: String?
        var id: String { device.id + (requestId ?? "remove") }
        var title: String {
            switch kind {
            case .approve: return "Approve essential apps on \(device.label)?"
            case .decline: return "Decline essential apps on \(device.label)?"
            case .remove: return "Remove essential apps on \(device.label)?"
            }
        }
        var button: String {
            switch kind { case .approve: return "Approve apps we reviewed"; case .decline: return "Decline"; case .remove: return "Remove" }
        }
    }

    private var essentialAppsSection: some View {
        Section {
            ForEach(devices) { device in
                VStack(alignment: .leading, spacing: Space.sm) {
                    Text(device.label).font(Typography.body.weight(.semibold))
                    Text("Approved: \(device.essentialApps?.summary.map { ScreenTimeFormat.summary($0) } ?? "No essential apps")")
                        .font(Typography.label)
                    if let pending = device.essentialApps?.pending {
                        Text("Waiting for you: \(ScreenTimeFormat.summary(pending.summary))")
                            .font(Typography.label.weight(.semibold)).foregroundStyle(Palette.frYouInk)
                        Text("Requested \(ScreenTimeFormat.relative(ScreenTimeFormat.date(pending.requestedAt)))")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond)
                        if let note = pending.note, !note.isEmpty {
                            Text("“\(note)”").font(Typography.label).foregroundStyle(Palette.textSecond)
                        }
                        Text("On \(kidName)'s \(device.label), open Essential apps and tap Review selected apps together. Then approve here. Counts don't identify the apps.")
                            .font(Typography.label).foregroundStyle(Palette.textSecond)
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: Space.md) { essentialDecisionButtons(device, requestId: pending.id) }
                            VStack(alignment: .leading, spacing: Space.sm) { essentialDecisionButtons(device, requestId: pending.id) }
                        }
                    }
                    if device.essentialApps?.summary?.isEmpty == false || device.essentialApps?.pending != nil {
                        Button("Remove essential apps", role: .destructive) {
                            essentialAction = EssentialAction(kind: .remove, device: device, requestId: nil)
                        }
                        .frame(minHeight: 44).buttonStyle(.borderless)
                        .disabled(essentialBusy)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, Space.xs)
            }
            if essentialBusy { HStack { ProgressView(); Text("Sending decision…") }.frame(minHeight: 44) }
            if let essentialError {
                Text(essentialError).foregroundStyle(Palette.frDanger)
                Button("Refresh proposals") { Task { await service.loadOverview() } }.frame(minHeight: 44)
            }
            Text(noFams
                 ? "Choose or replace a proposal in Fam ETC on your child's device: See our deal → Essential apps."
                 : "Choose or replace a proposal in Fam ETC on your child's device: Today → See our deal → Essential apps.")
                .font(Typography.label).foregroundStyle(Palette.textSecond)
        } header: { Text("Essential apps") }
        footer: { Text("Approved apps stay available during bedtime and quiet time only. Daily limits and a parent pause still apply. Approval is for this device's selection.") }
    }

    @ViewBuilder private func essentialDecisionButtons(_ device: ScreenTimeDevice, requestId: String) -> some View {
        Button("Approve apps we reviewed") { essentialAction = EssentialAction(kind: .approve, device: device, requestId: requestId) }
            .frame(minHeight: 44).buttonStyle(.borderless).disabled(essentialBusy)
        Button("Decline", role: .destructive) { essentialAction = EssentialAction(kind: .decline, device: device, requestId: requestId) }
            .frame(minHeight: 44).buttonStyle(.borderless).disabled(essentialBusy)
    }

    private func performEssentialAction(_ action: EssentialAction) {
        guard !essentialBusy else { return }
        if let requestId = action.requestId,
           devices.first(where: { $0.id == action.device.id })?.essentialApps?.pending?.id != requestId {
            essentialError = "This proposal changed. Review the current apps on your child's device before deciding."
            return
        }
        let id = kidId
        let account = store.me?.id
        essentialBusy = true
        essentialError = nil
        Task {
            do {
                switch action.kind {
                case .approve:
                    if let requestId = action.requestId { try await service.approveEssentialApps(kidId: id, deviceId: action.device.id, requestId: requestId) }
                case .decline:
                    if let requestId = action.requestId { try await service.declineEssentialApps(kidId: id, deviceId: action.device.id, requestId: requestId) }
                case .remove: try await service.removeEssentialApps(kidId: id, deviceId: action.device.id)
                }
            } catch {
                if id == kidId && account == store.me?.id { essentialError = error.localizedDescription }
                await service.loadOverview()
            }
            essentialBusy = false
        }
    }

    // MARK: Basic — more time requests

    /// Waiting requests (Approve / Not today), then today's granted extra time with delivery.
    @ViewBuilder private var requestSection: some View {
        let pending = requests.filter(\.isPending)
        let bonus = ScreenTimeSchedule.activeBonus(policy?.bonus, today: Date())
        if !pending.isEmpty || bonus != nil || requestError != nil {
            Section {
                ForEach(pending) { requestCard($0) }
                if let requestError {
                    Label(requestError, systemImage: "exclamationmark.triangle.fill")
                        .font(Typography.label)
                        .foregroundStyle(Palette.frDanger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let bonus, let policy {
                    Label("+\(ScreenTimeFormat.minutes(bonus)) extra today", systemImage: "plus.circle.fill")
                        .font(Typography.body.weight(.semibold))
                        .foregroundStyle(Palette.frD3Ink)
                        .monospacedDigit()
                    if !devices.isEmpty { deliveryLine(policy) }
                }
            } header: {
                Text("More time")
            } footer: {
                if !pending.isEmpty {
                    Text(noFams
                         ? "Approving adds the minutes to today only. Bedtime never moves."
                         : "Approving spends the fams and adds the minutes to today only. Bedtime never moves.")
                }
            }
        }
    }

    private func requestCard(_ r: ScreenTimeRequest) -> some View {
        let name = DealWords.firstName(kid?.name) ?? "Your child"
        return VStack(alignment: .leading, spacing: Space.sm) {
            VStack(alignment: .leading, spacing: 2) {
                Text("⏱️ \(ScreenTimeFormat.moreTimeLine(name: name, minutes: r.minutes, fams: r.fams, plan: store.productPlan))")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                if let note = r.note, !note.isEmpty {
                    Text("“\(note)”")
                        .font(Typography.label)
                        .foregroundStyle(Palette.textSecond)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Text(ScreenTimeFormat.relative(ScreenTimeFormat.date(r.createdAt)))
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            .accessibilityElement(children: .combine)
            if deciding == r.id {
                HStack(spacing: Space.sm) { ProgressView(); Text("Sending…") }
                    .font(Typography.caption).foregroundStyle(Palette.textSecond)
                    .frame(minHeight: 44)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: Space.sm) { decideButtons(r) }
                    VStack(alignment: .leading, spacing: Space.sm) { decideButtons(r) }
                }
                .disabled(deciding != nil)
            }
        }
        .padding(.vertical, Space.xs)
    }

    @ViewBuilder private func decideButtons(_ r: ScreenTimeRequest) -> some View {
        Button { decide(r, approve: true) } label: {
            Text("Approve")
                .font(Typography.label.weight(.semibold))
                .foregroundStyle(Palette.frOnYou)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 44)
                .background(Palette.frYou, in: Capsule())
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(noFams ? "Approve \(r.minutes) more minutes" : "Approve \(r.minutes) more minutes for \(r.fams) fams")
        Button { decide(r, approve: false) } label: {
            Text("Not today")
                .font(Typography.label.weight(.semibold))
                .foregroundStyle(Palette.frYouInk)
                .padding(.horizontal, Space.lg)
                .frame(minHeight: 44)
                .background(Capsule().strokeBorder(Palette.frYou, lineWidth: 1))
        }
        .buttonStyle(.borderless)
        .accessibilityLabel("Decline, not today")
    }

    private func decide(_ r: ScreenTimeRequest, approve: Bool) {
        Haptics.impact(.light)
        deciding = r.id
        requestError = nil
        justSaved = false
        Task {
            do {
                if approve {
                    try await service.approveRequest(kidId: kidId, requestId: r.id)
                    Haptics.notify(.success)
                } else {
                    try await service.declineRequest(kidId: kidId, requestId: r.id)
                }
            } catch {
                requestError = error.localizedDescription
                await service.loadOverview()
            }
            deciding = nil
        }
    }

    /// One small row: the signed family deal (tap → read-only), or a nudge to make one.
    @ViewBuilder private var dealRow: some View {
        if let state, let deal = state.agreement {
            Button {
                Haptics.selection()
                showDeal = true
            } label: {
                HStack {
                    Text("🤝 Deal signed with \(kidName)\(DealWords.signedDate(deal).map { " · \($0)" } ?? "")")
                        .font(Typography.label.weight(.semibold))
                        .foregroundStyle(Palette.text)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Palette.frInk3)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Shows the deal you made together")
            if deal.isStale(for: state.policy) {
                Text("Rules changed since — renew it together on \(kidName)'s phone.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
        } else {
            Text("No deal yet — make it together on \(kidName)'s phone")
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
        }
    }

    private func errorSection(_ message: String) -> some View {
        Section {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(Typography.label)
                .foregroundStyle(Palette.frDanger)
        }
    }

    // MARK: Basic — switches

    private func timeBinding(_ key: WritableKeyPath<BasicDraft, String>) -> Binding<Date> {
        Binding(
            get: { ScreenTimeFormat.dateFromHHMM(draft[keyPath: key]) ?? Date() },
            set: { draft[keyPath: key] = ScreenTimeFormat.hhmm($0) }
        )
    }

    private var bedtimeSection: some View {
        Section {
            Toggle(isOn: $draft.bedtimeOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Bedtime").font(Typography.body.weight(.semibold))
                    Text("Apps pause from \(ScreenTimeFormat.time(draft.bedStart)) to \(ScreenTimeFormat.time(draft.bedEnd))")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .monospacedDigit()
                }
            }
            if draft.bedtimeOn {
                DatePicker("From", selection: timeBinding(\.bedStart), displayedComponents: .hourAndMinute)
                DatePicker("Until", selection: timeBinding(\.bedEnd), displayedComponents: .hourAndMinute)
            }
        } footer: {
            if draft.bedtimeOn { Text("Every night. Phone calls still work.") }
        }
    }

    private func minutesStepper(_ title: String, value: Binding<Int>) -> some View {
        Stepper(value: value, in: 15...720, step: 15) {
            HStack {
                Text(title)
                Spacer()
                Text(ScreenTimeFormat.minutes(value.wrappedValue))
                    .font(Typography.body.weight(.semibold))
                    .monospacedDigit()
            }
        }
        .accessibilityValue(ScreenTimeFormat.minutes(value.wrappedValue))
    }

    private var dailySection: some View {
        Section {
            Toggle(isOn: $draft.totalOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Daily screen time").font(Typography.body.weight(.semibold))
                    Text("\(ScreenTimeFormat.minutes(draft.school)) on school days, \(ScreenTimeFormat.minutes(draft.weekend)) on weekends")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                        .monospacedDigit()
                }
            }
            if draft.totalOn {
                minutesStepper("School days", value: $draft.school)
                minutesStepper("Weekends", value: $draft.weekend)
            }
        } footer: {
            if draft.totalOn { Text("When the time is used up, apps pause until tomorrow.") }
        }
    }

    private var saveSection: some View {
        Section {
            if working {
                HStack(spacing: Space.sm) { ProgressView(); Text("Saving…") }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .foregroundStyle(Palette.textSecond)
            } else {
                AccentButton(title: "Save") { saveBasic() }
                    .disabled(draft == baseline)
                    .opacity(draft == baseline ? 0.5 : 1)
            }
            if draft == baseline, let policy, hasRules, !devices.isEmpty, justSaved || devices.contains(where: { !$0.applied(policy) }) {
                deliveryLine(policy)
            }
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    private func saveBasic() {
        guard let policy else { return }
        var downtime = policy.downtime.filter { $0.id != ScreenTimeFormat.bedtimeID }
        if draft.bedtimeOn {
            var bed = policy.downtime.first { $0.id == ScreenTimeFormat.bedtimeID }
                ?? ScreenTimeDowntime(id: ScreenTimeFormat.bedtimeID, name: "Bedtime", start: "21:00", end: "07:00",
                                      days: ScreenTimeFormat.everyDay)
            bed.start = draft.bedStart
            bed.end = draft.bedEnd
            downtime.insert(bed, at: 0)
        }
        var limits = policy.limits.filter { !$0.isTotal }
        if draft.totalOn {
            var total = policy.limits.first(where: \.isTotal) ?? .newLimit(id: ScreenTimeFormat.totalID, kind: "total", name: "Screen time")
            total.minutesPerDay = draft.school
            total.weekendMinutes = draft.weekend
            limits.insert(total, at: 0)
        }
        run {
            try await save(limits: limits, downtime: downtime)
            Haptics.notify(.success)
            justSaved = true
            refreshAwaitingDevices(after: Date())
        }
    }

    private var setupStepsSection: some View {
        Section {
            ForEach(Array(setupSteps.enumerated()), id: \.offset) { i, step in
                HStack(alignment: .firstTextBaseline, spacing: Space.md) {
                    Text("\(i + 1)")
                        .font(Typography.label.weight(.bold))
                        .foregroundStyle(Palette.onAccent)
                        .frame(width: 26, height: 26)
                        .background(Palette.accent, in: Circle())
                        .accessibilityHidden(true)
                    Text(step)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Step \(i + 1). \(step)")
            }
        } header: {
            Text("Set it up on \(kidName)'s phone")
        } footer: {
            Text("Your rules start working once this is done. You'll see it here.")
        }
    }

    private var setupSteps: [String] {
        ["On \(kidName)'s phone, open Fam ETC and sign in as \(kidName).",
         "Tap “Make our Screen Time deal” on \(kidHome).",
         "Make the deal together: add your promises, approve when the phone asks, and sign."]
    }

    // MARK: Basic — off / turn off (docs/SCREEN-TIME-UX.md §4)

    /// Shown instead of the Basic switches while the parent has Screen Time off.
    private var offSection: some View {
        Section {
            Group {
                if working {
                    HStack(spacing: Space.sm) { ProgressView(); Text("Saving…") }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .foregroundStyle(Palette.textSecond)
                } else {
                    AccentButton(title: "Turn Screen Time back on", systemImage: "power") { setEnabled(true) }
                        .accessibilityHint("Bedtime and daily time start again on \(kidName)'s devices")
                        .accessibilityIdentifier("screentime.turnOn")
                }
            }
            .id(Self.offRowID)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
    }

    /// "Off on Mia's iPad" / "Mia's iPad hasn't picked this up yet" + Check.
    private func offDeliveryLine(_ policy: ScreenTimePolicy) -> some View {
        let pending = devices.filter { !$0.applied(policy) }
        return HStack(spacing: Space.xs) {
            Image(systemName: pending.isEmpty ? "checkmark.circle.fill" : "clock.arrow.circlepath")
                .foregroundStyle(pending.isEmpty ? Palette.frInk2 : Palette.frFamsInk)
                .accessibilityHidden(true)
            Text(pending.isEmpty
                 ? "Off on \(ScreenTimeFormat.deviceNames(devices, kidName: kidName))"
                 : "\(ScreenTimeFormat.deviceNames(pending, kidName: kidName)) \(pending.count == 1 ? "hasn't" : "haven't") picked this up yet")
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.xs)
            if !pending.isEmpty {
                Button("Check") { requestProtectionCheck() }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                    .disabled(checkingProtection)
                    .accessibilityHint("Checks whether the change reached the device")
            }
        }
        .font(Typography.caption)
        .foregroundStyle(Palette.text)
    }

    /// The last Basic row while Screen Time is on: an explicit, confirmed turn-off that
    /// keeps the rules and the deal.
    private var turnOffSection: some View {
        let targets = ScreenTimeFormat.deviceNames(devices, kidName: kidName)
        let several = devices.count > 1
        return Section {
            Button("Turn off Screen Time", role: .destructive) {
                Haptics.selection()
                confirmTurnOff = true
            }
            .frame(minHeight: 44)
            .disabled(working || pausing)
            .accessibilityIdentifier("screentime.turnOff")
            .confirmationDialog("Turn off Screen Time for \(kidName)?", isPresented: $confirmTurnOff,
                                titleVisibility: .visible) {
                Button("Turn off", role: .destructive) { setEnabled(false) }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Bedtime and daily time stop on \(targets) as soon as \(several ? "they check" : "it checks") in — usually within a minute when \(several ? "they're" : "it's") online. Your settings and your deal are kept, and alerts stop.")
            }
        }
    }

    /// Turn off / back on with the saved lists unchanged (the server keeps rules + deal).
    private func setEnabled(_ on: Bool) {
        guard let policy else { return }
        run {
            try await service.savePolicy(kidId: kidId, enabled: on, limits: policy.limits, downtime: policy.downtime)
            Haptics.notify(.success)
            if on { justSaved = true }
        }
    }

    // MARK: Basic — pause

    private var pauseSection: some View {
        let until = ScreenTimeFormat.pauseUntil(policy)
        return Section {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: Space.sm) { pauseButtons(paused: until != nil) }
                VStack(alignment: .leading, spacing: Space.sm) { pauseButtons(paused: until != nil) }
            }
            .disabled(pausing || working)
            if pausing {
                HStack(spacing: Space.sm) { ProgressView(); Text("Sending…") }
                    .font(Typography.caption).foregroundStyle(Palette.textSecond)
            } else if let policy, until != nil {
                deliveryLine(policy)
            }
        } header: {
            Text("Pause now")
        } footer: {
            Text("Pauses all apps except phone calls on \(ScreenTimeFormat.deviceNames(devices, kidName: kidName)) as soon as it's online.")
        }
    }

    @ViewBuilder
    private func pauseButtons(paused: Bool) -> some View {
        pauseButton("1 hour", minutes: 60)
        pauseButton("Until tomorrow", minutes: minutesUntilMorning)
        if paused { pauseButton("Resume", minutes: 0) }
    }

    private func pauseButton(_ title: String, minutes: Int) -> some View {
        Button {
            Haptics.impact(.light)
            pausing = true
            error = nil
            justSaved = false
            Task {
                do { try await service.pause(kidId: kidId, minutes: minutes) } catch { self.error = error.localizedDescription }
                pausing = false
            }
        } label: {
            Text(title)
                .font(Typography.label.weight(.semibold))
                .foregroundStyle(minutes == 0 ? Palette.onAccent : Palette.frYouInk)
                .padding(.horizontal, Space.md)
                .frame(minHeight: 44)
                .background {
                    if minutes == 0 { Capsule().fill(Palette.accent) }
                    else { Capsule().strokeBorder(Palette.frYou, lineWidth: 1) }
                }
        }
        .buttonStyle(.borderless)
        .accessibilityLabel(minutes == 0 ? "Resume apps" : "Pause apps for \(title)")
    }

    /// Minutes until the next 7 AM (server accepts 15–1440).
    private var minutesUntilMorning: Int { ScreenTimeFormat.minutesUntilMorning() }

    /// "Applied on Mia's iPhone" vs "Pending on Mia's iPad" — from each device's reported version.
    private func deliveryLine(_ policy: ScreenTimePolicy) -> some View {
        let pending = devices.filter { !$0.applied(policy) }
        return HStack(spacing: Space.xs) {
            Image(systemName: pending.isEmpty ? "checkmark.circle.fill" : "clock.arrow.circlepath")
                .foregroundStyle(pending.isEmpty ? Palette.green : Palette.frFamsInk)
                .accessibilityHidden(true)
            Text(pending.isEmpty
                 ? "Confirmed on \(ScreenTimeFormat.deviceNames(devices, kidName: kidName))"
                 : "Pending on \(ScreenTimeFormat.deviceNames(pending, kidName: kidName))")
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: Space.xs)
            if !pending.isEmpty {
                Button("Check") { requestProtectionCheck() }
                    .buttonStyle(.borderless)
                    .frame(minHeight: 44)
                    .disabled(checkingProtection)
                    .accessibilityHint("Checks whether the change reached the device")
            }
        }
        .font(Typography.caption)
        .foregroundStyle(Palette.text)
        .padding(.horizontal, Space.xs)
    }

    // MARK: Advanced

    private var advancedToggle: some View {
        Section {
            Button {
                Haptics.selection()
                withAnimation(reduceMotion ? nil : Motion.snappy) { showAdvanced.toggle() }
            } label: {
                HStack {
                    Text("Advanced").font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .rotationEffect(.degrees(showAdvanced ? 90 : 0))
                        .foregroundStyle(Palette.frInk3)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(showAdvanced ? "Expanded" : "Collapsed")
        } footer: {
            if !showAdvanced { Text("Limits for single apps, more quiet times, devices and alert history.") }
        }
    }

    private var limitsSection: some View {
        Section {
            ForEach(appLimits) { limit in
                Button { editingLimit = limit } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ScreenTimeFormat.limitLine(limit))
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.text)
                            .monospacedDigit()
                        Text(limit.selection == nil ? "Apps chosen on \(kidName)'s device" : ScreenTimeFormat.summary(limit.selectionSummary))
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                        ForEach(deviceSummaries(limit), id: \.self) {
                            Text($0).font(Typography.caption).foregroundStyle(Palette.textSecond)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Edit this limit")
            }
            if (policy?.limits.count ?? 0) < 8 {
                Button {
                    editingLimit = .newLimit(id: "", kind: "apps", name: "")
                } label: {
                    Label("Add an app limit", systemImage: "plus.circle.fill")
                }
            }
        } header: {
            Text("App limits")
        } footer: {
            Text("For example, Games for 1 h a day. When the time is used up, those apps pause until tomorrow.")
        }
    }

    private func deviceSummaries(_ limit: ScreenTimeLimit) -> [String] {
        (limit.deviceSelections ?? [:]).sorted { $0.key < $1.key }.map { id, summary in
            let label = devices.first { $0.id == id }?.label ?? "another device"
            return "On \(kidName)'s \(label): \(ScreenTimeFormat.summary(summary))"
        }
    }

    private var downtimeSection: some View {
        Section {
            ForEach(extraDowntime) { d in
                Button { editingDowntime = d } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ScreenTimeFormat.downtimeLine(d))
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.text)
                            .monospacedDigit()
                        Text(ScreenTimeFormat.days(d.days))
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Edit this quiet time")
            }
            if (policy?.downtime.count ?? 0) < 4 {
                Button {
                    editingDowntime = ScreenTimeDowntime(id: "", name: "", start: "16:00", end: "18:00",
                                                         days: [2, 3, 4, 5, 6])
                } label: {
                    Label("Add a quiet time", systemImage: "moon.fill")
                }
            }
        } header: {
            Text("More quiet times")
        } footer: {
            Text("Like Bedtime: apps pause except phone calls and approved essential apps. Set the days each one starts. Daily limits and a parent pause still apply.")
        }
    }

    private var devicesSection: some View {
        Section {
            if devices.isEmpty {
                Text("No devices yet.").foregroundStyle(Palette.textSecond)
            }
            ForEach(devices) { deviceRow($0) }
        } header: {
            Text("Devices")
        }
    }

    /// A device row's "Move to <name>" target: which device, to which sibling.
    private struct MoveTarget: Identifiable {
        let device: ScreenTimeDevice
        let toKid: Kid
        var id: String { "\(device.id)->\(toKid.id)" }
    }

    private func deviceRow(_ device: ScreenTimeDevice) -> some View {
        let applied = policy.map(device.applied) ?? false
        return VStack(alignment: .leading, spacing: Space.sm) {
            HStack(alignment: .firstTextBaseline) {
                Label(device.label, systemImage: device.label.localizedCaseInsensitiveContains("ipad") ? "ipad" : "iphone")
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                Spacer()
                deviceStateChip(device)
            }
            ScreenTimeChip(text: device.modeTitle,
                           ink: device.isFamily ? Palette.frD3Ink : Palette.frYouInk,
                           soft: device.isFamily ? Palette.frD3Soft : Palette.frYouSoft)
            Text(device.modeMeaning)
                .font(Typography.label)
                .foregroundStyle(Palette.textSecond)
            HStack(spacing: Space.xs) {
                Image(systemName: applied ? "checkmark.circle.fill" : "clock.arrow.circlepath")
                    .foregroundStyle(applied ? Palette.green : Palette.frFamsInk)
                    .accessibilityHidden(true)
                Text(applied ? "Applied" : "Pending on \(kidName)'s \(device.label)")
                Text("· last check-in \(ScreenTimeFormat.relative(ScreenTimeFormat.date(device.lastSeenAt)))")
                    .foregroundStyle(Palette.textSecond)
            }
            .font(Typography.caption)
            .monospacedDigit()
            Button("Forget device", role: .destructive) { forgetting = device }
                .font(Typography.caption.weight(.semibold))
                .buttonStyle(.borderless)
                .frame(minHeight: 44)
            if otherKids.count > 0 {
                ForEach(otherKids) { other in
                    Button("Move to \(other.name)") { moving = MoveTarget(device: device, toKid: other) }
                        .font(Typography.caption.weight(.semibold))
                        .buttonStyle(.borderless)
                        .frame(minHeight: 44)
                }
            }
        }
        .padding(.vertical, Space.xs)
        .accessibilityElement(children: .contain)
    }

    private func deviceStateChip(_ device: ScreenTimeDevice) -> some View {
        let confirmed = policy.map(device.applied) ?? false
        return ScreenTimeChip(text: ScreenTimeEssentialsPresentation.protection(device, policy: policy ?? .disabled),
                              ink: confirmed ? Palette.frD3Ink : Palette.frFamsInk,
                              soft: confirmed ? Palette.frD3Soft : Palette.frFamsSoft)
    }

    private var alertHistorySection: some View {
        let alerts = (state?.alerts ?? []).sorted {
            (ScreenTimeFormat.date($0.at) ?? .distantPast) > (ScreenTimeFormat.date($1.at) ?? .distantPast)
        }
        return Section {
            if alerts.isEmpty {
                Text("No reminders yet. Device-reported access and app changes appear here. After a day without a device check, we'll remind you to check it.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
            }
            ForEach(alerts.prefix(20)) { alert in
                HStack(alignment: .top, spacing: Space.sm) {
                    Circle()
                        .fill(alert.ackedAt == nil ? Palette.frDanger : Color.clear)
                        .frame(width: 8, height: 8)
                        .padding(.top, 6)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(ScreenTimeEssentialsPresentation.neutralAlert(type: alert.type, kidName: kidName))
                            .font(Typography.body.weight(alert.ackedAt == nil ? .semibold : .regular))
                            .foregroundStyle(Palette.text)
                        Text(ScreenTimeFormat.relative(ScreenTimeFormat.date(alert.at)))
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(alert.ackedAt == nil ? "New" : "")
            }
        } header: {
            Text("Alert history")
        }
    }

    private var requestHistorySection: some View {
        Section {
            if requests.isEmpty {
                Text(noFams
                     ? "No requests yet. \(kidName) can ask for more time on their phone."
                     : "No requests yet. \(kidName) can ask for more time on their phone and pay with fams.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
            }
            ForEach(requests.prefix(10)) { r in
                let chip = Self.requestChip(r.status)
                HStack(alignment: .firstTextBaseline, spacing: Space.sm) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(noFams ? "\(r.minutes) min" : "\(r.minutes) min · \(r.fams) fams")
                            .font(Typography.body.weight(.semibold))
                            .foregroundStyle(Palette.text)
                            .monospacedDigit()
                        if let note = r.note, !note.isEmpty {
                            Text("“\(note)”").font(Typography.label).foregroundStyle(Palette.textSecond)
                        }
                        Text(ScreenTimeFormat.relative(ScreenTimeFormat.date(r.createdAt)))
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                    Spacer(minLength: Space.sm)
                    ScreenTimeChip(text: chip.text, ink: chip.ink, soft: chip.soft)
                }
                .accessibilityElement(children: .combine)
            }
        } header: {
            Text("Time requests")
        }
    }

    static func requestChip(_ status: String) -> (text: String, ink: Color, soft: Color) {
        switch status {
        case "pending": return ("Waiting", Palette.frYouInk, Palette.frYouSoft)
        case "approved": return ("Approved", Palette.frD3Ink, Palette.frD3Soft)
        case "declined": return ("Not today", Palette.frInk2, Palette.frCard2)
        default: return ("Expired", Palette.frInk2, Palette.frCard2)
        }
    }

    /// Apple's app-by-app report only reaches parents for Family Sharing children.
    private var detailedUsageSection: some View {
        let familySharing = service.overview?.kids.contains { $0.devices.contains(where: \.isFamily) } ?? false
        return Section {
            if familySharing {
                ScreenTimeFamilyUsageReport()
                    .listRowInsets(EdgeInsets(top: Space.sm, leading: Space.md, bottom: Space.sm, trailing: Space.md))
            } else {
                Text("App-by-app details need Family Sharing. You'll still see daily totals on fametc.com and here.")
                    .font(Typography.label)
                    .foregroundStyle(Palette.textSecond)
            }
        } header: {
            Text("Detailed usage")
        } footer: {
            if familySharing {
                Text("From Apple Screen Time, for the children in your Family Sharing group. Fam ETC doesn’t receive these details.")
            }
        }
    }

    private var howSection: some View {
        Section {
            DisclosureGroup("How protection works", isExpanded: $showHow) {
                VStack(alignment: .leading, spacing: Space.md) {
                    howRow("With Family Sharing",
                           "\(kidName)'s Apple Account is a child in your Family Sharing group, and a parent approves on their device. \(kidName) can't delete Fam ETC or turn Screen Time access off, and you can choose apps from this phone.")
                    howRow("Without Family Sharing",
                           "For devices set up without a child Apple Account. Limits and bedtime are real, but \(kidName) approves with their own Face ID and could turn access off in Settings or delete Fam ETC. Apps are chosen on \(kidName)'s device.")
                    howRow("Device reminders",
                           "We'll tell you when the device reports an access or app-selection change. After a day without a device check, we'll remind you to check it. An offline device doesn't tell us what happened.")
                    howRow("Changes and pauses",
                           "Changes reach each device when it next checks in. Waiting means we don't yet have confirmation from that device.")
                }
                .padding(.vertical, Space.xs)
            }
        }
    }

    private func howRow(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(Typography.body.weight(.semibold)).foregroundStyle(Palette.text)
            Text(body).font(Typography.label).foregroundStyle(Palette.textSecond)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Saving

    private func run(_ op: @escaping () async throws -> Void) {
        working = true
        error = nil
        justSaved = false
        Task {
            do { try await op() } catch { self.error = error.localizedDescription }
            working = false
        }
    }

    /// Always sends the full lists, so Basic saves keep Advanced items and vice versa.
    /// Advanced edits while Off stay off; only "Turn Screen Time back on" turns it on.
    private func save(limits: [ScreenTimeLimit], downtime: [ScreenTimeDowntime]) async throws {
        try await service.savePolicy(kidId: kidId,
                                     enabled: !isOff && (!limits.isEmpty || !downtime.isEmpty),
                                     limits: limits,
                                     downtime: downtime)
    }

    /// `updated == nil` deletes. Basic items come from the saved policy, not the draft.
    private func saveAdvancedLimit(replacing id: String, with updated: ScreenTimeLimit?) async throws {
        var list = policy?.limits ?? []
        if !id.isEmpty, let i = list.firstIndex(where: { $0.id == id }) {
            if let updated { list[i] = updated } else { list.remove(at: i) }
        } else if let updated { list.append(updated) }
        try await save(limits: list, downtime: policy?.downtime ?? [])
    }

    private func saveAdvancedDowntime(replacing id: String, with updated: ScreenTimeDowntime?) async throws {
        var list = policy?.downtime ?? []
        if !id.isEmpty, let i = list.firstIndex(where: { $0.id == id }) {
            if let updated { list[i] = updated } else { list.remove(at: i) }
        } else if let updated { list.append(updated) }
        try await save(limits: policy?.limits ?? [], downtime: list)
    }
}

extension ScreenTimeLimit {
    /// A limit the parent is creating; an empty `id` lets the server assign one.
    static func newLimit(id: String, kind: String, name: String) -> ScreenTimeLimit {
        ScreenTimeLimit(id: id, kind: kind, name: name, minutesPerDay: kind == "total" ? 120 : 60,
                        weekendMinutes: kind == "total" ? 180 : nil,
                        selection: nil, selectionSummary: nil, deviceSelections: nil)
    }
}

// MARK: - App limit editor (Advanced)

private struct ScreenTimeLimitEditor: View {
    @Environment(\.dismiss) private var dismiss
    let kidName: String
    let isNew: Bool
    let devices: [ScreenTimeDevice]
    let onSave: (ScreenTimeLimit?) async throws -> Void

    @State private var limit: ScreenTimeLimit
    @State private var weekendDifferent: Bool
    @State private var selection: FamilyActivitySelection
    @State private var selectionChanged = false
    @State private var showPicker = false
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    private static let presets = [15, 30, 45, 60, 90, 120, 180, 240]

    init(kidName: String, limit: ScreenTimeLimit, isNew: Bool, devices: [ScreenTimeDevice],
         onSave: @escaping (ScreenTimeLimit?) async throws -> Void) {
        self.kidName = kidName
        self.isNew = isNew
        self.devices = devices
        self.onSave = onSave
        _limit = State(initialValue: limit)
        _weekendDifferent = State(initialValue: limit.weekendMinutes.map { $0 != limit.minutesPerDay } ?? false)
        _selection = State(initialValue: ScreenTimeService.shared.selection(for: limit))
    }

    private var anyFamilyDevice: Bool { devices.contains(where: \.isFamily) }
    private var trimmedName: String { limit.name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var weekendBinding: Binding<Int> {
        Binding(get: { limit.weekendMinutes ?? limit.minutesPerDay }, set: { limit.weekendMinutes = $0 })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Games", text: $limit.name)
                        .onChange(of: limit.name) { _, v in if v.count > 40 { limit.name = String(v.prefix(40)) } }
                }
                Section {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 80), spacing: Space.sm)], spacing: Space.sm) {
                        ForEach(Self.presets, id: \.self) { m in
                            let on = limit.minutesPerDay == m
                            Button {
                                Haptics.selection()
                                limit.minutesPerDay = m
                            } label: {
                                Text(ScreenTimeFormat.minutes(m))
                                    .font(Typography.label.weight(.semibold))
                                    .monospacedDigit()
                                    .foregroundStyle(on ? Palette.onAccent : Palette.frYouInk)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background {
                                        if on { Capsule().fill(Palette.accent) }
                                        else { Capsule().strokeBorder(Palette.frYou, lineWidth: 1) }
                                    }
                            }
                            .buttonStyle(.borderless)
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, Space.xs)
                    Stepper(value: $limit.minutesPerDay, in: 5...720, step: 5) {
                        Text("\(weekendDifferent ? "School days" : "Every day"): \(ScreenTimeFormat.minutes(limit.minutesPerDay))")
                            .monospacedDigit()
                    }
                    Toggle("Different time on weekends", isOn: $weekendDifferent)
                    if weekendDifferent {
                        Stepper(value: weekendBinding, in: 5...720, step: 5) {
                            Text("Weekends: \(ScreenTimeFormat.minutes(weekendBinding.wrappedValue))").monospacedDigit()
                        }
                    }
                } header: {
                    Text("Time per day")
                }
                Section {
                    Button {
                        showPicker = true
                    } label: {
                        Label("Choose apps on this iPhone", systemImage: "square.grid.2x2")
                    }
                    Text(selectionChanged ? ScreenTimeFormat.summary(ScreenTimeService.summary(of: selection))
                                          : ScreenTimeFormat.summary(limit.selectionSummary))
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                    ForEach((limit.deviceSelections ?? [:]).sorted { $0.key < $1.key }, id: \.key) { id, summary in
                        Text("On \(kidName)'s \(devices.first { $0.id == id }?.label ?? "device"): \(ScreenTimeFormat.summary(summary))")
                            .font(Typography.caption)
                            .foregroundStyle(Palette.textSecond)
                    }
                } header: {
                    Text("Apps")
                } footer: {
                    Text(anyFamilyDevice
                         ? "Choosing here works for devices set up with Family Sharing. For a device without Family Sharing, choose the apps on \(kidName)'s device instead."
                         : "Choosing here works when \(kidName)'s device uses Family Sharing. Otherwise choose the apps on \(kidName)'s device: Fam ETC → Today → Screen Time → See my rules.")
                }
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(Typography.label)
                            .foregroundStyle(Palette.frDanger)
                    }
                }
                if !isNew {
                    Section {
                        Button("Delete limit", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(ScreenBackground())
            .navigationTitle(isNew ? "New app limit" : "Edit app limit")
            .navigationBarTitleDisplayMode(.inline)
            .familyActivityPicker(isPresented: $showPicker, selection: $selection)
            .onChange(of: selection) { _, _ in selectionChanged = true }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else {
                        Button("Save") { commit(delete: false) }.disabled(trimmedName.isEmpty)
                    }
                }
            }
            .confirmationDialog("Delete this limit?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete \(trimmedName.isEmpty ? "limit" : trimmedName)", role: .destructive) { commit(delete: true) }
            }
            .interactiveDismissDisabled(saving)
        }
    }

    private func commit(delete: Bool) {
        var out = limit
        out.name = trimmedName
        out.kind = "apps"
        out.weekendMinutes = weekendDifferent ? (limit.weekendMinutes ?? limit.minutesPerDay) : nil
        if selectionChanged {
            out.selection = ScreenTimeService.encode(selection)
            out.selectionSummary = ScreenTimeService.summary(of: selection)
        }
        saving = true
        error = nil
        Task {
            do {
                try await onSave(delete ? nil : out)
                Haptics.notify(.success)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}

// MARK: - Quiet time editor (Advanced)

private struct ScreenTimeDowntimeEditor: View {
    @Environment(\.dismiss) private var dismiss
    let isNew: Bool
    let onSave: (ScreenTimeDowntime?) async throws -> Void

    @State private var downtime: ScreenTimeDowntime
    @State private var start: Date
    @State private var end: Date
    @State private var saving = false
    @State private var error: String?
    @State private var confirmDelete = false

    init(downtime: ScreenTimeDowntime, isNew: Bool, onSave: @escaping (ScreenTimeDowntime?) async throws -> Void) {
        self.isNew = isNew
        self.onSave = onSave
        _downtime = State(initialValue: downtime)
        _start = State(initialValue: ScreenTimeFormat.dateFromHHMM(downtime.start) ?? Date())
        _end = State(initialValue: ScreenTimeFormat.dateFromHHMM(downtime.end) ?? Date())
    }

    private var trimmedName: String { downtime.name.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Homework time", text: $downtime.name)
                        .onChange(of: downtime.name) { _, v in if v.count > 40 { downtime.name = String(v.prefix(40)) } }
                }
                Section {
                    DatePicker("From", selection: $start, displayedComponents: .hourAndMinute)
                    DatePicker("Until", selection: $end, displayedComponents: .hourAndMinute)
                } header: {
                    Text("Time")
                } footer: {
                    if ScreenTimeFormat.hhmm(end) < ScreenTimeFormat.hhmm(start) {
                        Text("Ends the next morning.")
                    }
                }
                Section {
                    HStack(spacing: Space.xs) {
                        ForEach(ScreenTimeFormat.orderedWeekdays, id: \.self) { day in
                            let on = downtime.days.contains(day)
                            Button {
                                Haptics.selection()
                                if on { downtime.days.removeAll { $0 == day } } else { downtime.days.append(day); downtime.days.sort() }
                            } label: {
                                Text(Calendar.current.veryShortWeekdaySymbols[day - 1])
                                    .font(Typography.label.weight(.semibold))
                                    .foregroundStyle(on ? Palette.onAccent : Palette.frYouInk)
                                    .frame(maxWidth: .infinity, minHeight: 44)
                                    .background {
                                        if on { Capsule().fill(Palette.accent) }
                                        else { Capsule().strokeBorder(Palette.frYou, lineWidth: 1) }
                                    }
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(Calendar.current.weekdaySymbols[day - 1])
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.vertical, Space.xs)
                } header: {
                    Text("Starts on")
                } footer: {
                    Text(ScreenTimeFormat.days(downtime.days))
                }
                if let error {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(Typography.label)
                            .foregroundStyle(Palette.frDanger)
                    }
                }
                if !isNew {
                    Section {
                        Button("Delete quiet time", role: .destructive) { confirmDelete = true }
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(ScreenBackground())
            .navigationTitle(isNew ? "New quiet time" : "Edit quiet time")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else {
                        Button("Save") { commit(delete: false) }
                            .disabled(trimmedName.isEmpty || downtime.days.isEmpty || ScreenTimeFormat.hhmm(start) == ScreenTimeFormat.hhmm(end))
                    }
                }
            }
            .confirmationDialog("Delete this quiet time?", isPresented: $confirmDelete, titleVisibility: .visible) {
                Button("Delete \(trimmedName.isEmpty ? "quiet time" : trimmedName)", role: .destructive) { commit(delete: true) }
            }
            .interactiveDismissDisabled(saving)
        }
    }

    private func commit(delete: Bool) {
        var out = downtime
        out.name = trimmedName
        out.start = ScreenTimeFormat.hhmm(start)
        out.end = ScreenTimeFormat.hhmm(end)
        saving = true
        error = nil
        Task {
            do {
                try await onSave(delete ? nil : out)
                Haptics.notify(.success)
                dismiss()
            } catch {
                self.error = error.localizedDescription
            }
            saving = false
        }
    }
}
