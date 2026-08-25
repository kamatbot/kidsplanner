import SwiftUI

/// Native projection of the PathOdds daily SAT Quest. FamETC renders only the
/// behavior summary; question content, answers, mastery, XP calculation and
/// quest completion remain owned by PathOdds.
struct PathOddsQuestCard: View {
    @Environment(\.openURL) private var openURL
    @State private var response: PathOddsTodayResponse?
    @State private var loading = true
    @State private var actionInFlight = false
    @State private var errorText: String?

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(spacing: Space.sm) {
                    Text("P")
                        .font(Typography.caption.weight(.heavy))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Palette.text, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    MicroLabel(text: "PathOdds SAT")
                    Spacer()
                    if let streak = response?.snapshot?.state.currentStreak, streak > 0 {
                        Label("\(streak)d", systemImage: "flame.fill")
                            .font(Typography.caption.weight(.bold))
                            .foregroundStyle(Palette.warn)
                    }
                }

                if loading && response == nil {
                    ProgressView().tint(Palette.accent)
                    Text("Checking today's SAT plan…")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                } else if response?.linked == false {
                    Text("Connect your daily SAT plan")
                        .font(Typography.cardTitle.weight(.bold))
                        .foregroundStyle(Palette.text)
                    Text("FamETC keeps the habit visible. PathOdds handles the adaptive practice and deep work.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                    AccentButton(title: actionInFlight ? "Connecting…" : "Connect PathOdds") {
                        Task { await connect() }
                    }
                    .disabled(actionInFlight)
                } else if let snapshot = response?.snapshot {
                    questContent(snapshot)
                } else {
                    Text("PathOdds status is unavailable")
                        .font(Typography.cardTitle.weight(.bold))
                    Text(errorText ?? "Your other FamETC tools still work. Retry when you're ready.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                    Button("Retry") { Task { await refresh() } }
                        .font(Typography.caption.weight(.bold))
                        .foregroundStyle(Palette.accent)
                }
            }
        }
        .task { await refresh() }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func questContent(_ snapshot: PathOddsModuleSnapshot) -> some View {
        let state = snapshot.state
        Text(state.title)
            .font(Typography.cardTitle.weight(.bold))
            .foregroundStyle(Palette.text)
        Text(state.detail)
            .font(Typography.caption)
            .foregroundStyle(Palette.textSecond)
            .fixedSize(horizontal: false, vertical: true)

        if ["ready", "in-progress", "completed"].contains(state.readiness) {
            ProgressView(value: state.progress)
                .tint(state.readiness == "completed" ? Palette.green : Palette.accent)
            HStack {
                Text("\(state.answered ?? 0)/\(state.total ?? 11) questions")
                Spacer()
                if let xp = state.xpAvailable { Text("\(xp) XP available") }
            }
            .font(Typography.mono(10.5))
            .foregroundStyle(Palette.textSecond)
        }

        AccentButton(title: actionInFlight ? "Opening…" : state.actionTitle) {
            Task { await launch(route: snapshot.action?.route ?? "sat.home") }
        }
        .disabled(actionInFlight)
    }

    @MainActor
    private func refresh() async {
        loading = true
        errorText = nil
        do {
            response = try await PathOddsAPI.shared.today()
        } catch {
            errorText = error.localizedDescription
        }
        loading = false
    }

    @MainActor
    private func connect() async {
        actionInFlight = true
        errorText = nil
        do {
            _ = try await PathOddsAPI.shared.connect()
            response = try await PathOddsAPI.shared.today()
        } catch {
            errorText = error.localizedDescription
        }
        actionInFlight = false
    }

    @MainActor
    private func launch(route: String) async {
        actionInFlight = true
        errorText = nil
        do {
            let launch = try await PathOddsAPI.shared.launch(route: route)
            guard let url = URL(string: launch.launchUrl) else { throw APIError.badURL }
            openURL(url)
        } catch {
            errorText = error.localizedDescription
        }
        actionInFlight = false
    }
}

/// Parent projection. A parent can pre-provision a child's integration and see
/// high-level completion, but there is intentionally no child launch action.
struct PathOddsFamilySummaryCard: View {
    @Environment(AppStore.self) private var store
    @State private var rows: [String: PathOddsTodayResponse] = [:]
    @State private var loadingIds: Set<String> = []

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: Space.md) {
                HStack(spacing: Space.sm) {
                    Text("P")
                        .font(Typography.caption.weight(.heavy))
                        .foregroundStyle(.white)
                        .frame(width: 28, height: 28)
                        .background(Palette.text, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    MicroLabel(text: "PathOdds SAT")
                }
                Text("Daily SAT progress")
                    .font(Typography.cardTitle.weight(.bold))
                    .foregroundStyle(Palette.text)
                Text("You can see the habit here. Each child completes the actual learning work in their own PathOdds session.")
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)

                if store.kids.isEmpty {
                    Text("Add a kid profile to track PathOdds here.")
                        .font(Typography.caption)
                        .foregroundStyle(Palette.textSecond)
                } else {
                    VStack(spacing: Space.sm) {
                        ForEach(store.kids) { kid in
                            familyRow(kid)
                        }
                    }
                }
            }
        }
        .task { await refreshAll() }
    }

    @ViewBuilder
    private func familyRow(_ kid: Kid) -> some View {
        let payload = rows[kid.id]
        HStack(spacing: Space.md) {
            VStack(alignment: .leading, spacing: 2) {
                Text(kid.name)
                    .font(Typography.body.weight(.semibold))
                    .foregroundStyle(Palette.text)
                Text(statusText(payload))
                    .font(Typography.caption)
                    .foregroundStyle(Palette.textSecond)
            }
            Spacer()
            if loadingIds.contains(kid.id) {
                ProgressView().controlSize(.small)
            } else if payload?.linked == false {
                Button("Set up") { Task { await connect(kid) } }
                    .font(Typography.caption.weight(.bold))
                    .foregroundStyle(Palette.accent)
            } else if payload?.snapshot?.state.readiness == "completed" {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Palette.green)
            } else if let state = payload?.snapshot?.state {
                Text("\(state.answered ?? 0)/\(state.total ?? 11)")
                    .font(Typography.mono(12, .bold))
                    .foregroundStyle(Palette.textSecond)
            }
        }
        .padding(.horizontal, Space.md)
        .padding(.vertical, Space.sm + 2)
        .background(Palette.panel2, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func statusText(_ payload: PathOddsTodayResponse?) -> String {
        guard let payload else { return "Checking…" }
        guard payload.linked, let state = payload.snapshot?.state else { return "Not connected" }
        switch state.readiness {
        case "completed": return "Quest complete"
        case "in-progress": return "Quest in progress"
        case "setup-required": return "Setup needed"
        case "diagnostic-required": return "Diagnostic needed"
        default: return "Ready today"
        }
    }

    @MainActor
    private func refreshAll() async {
        await withTaskGroup(of: (String, PathOddsTodayResponse?).self) { group in
            for kid in store.kids {
                group.addTask {
                    let value = try? await PathOddsAPI.shared.today(kidId: kid.id)
                    return (kid.id, value)
                }
            }
            for await (kidId, value) in group {
                if let value { rows[kidId] = value }
            }
        }
    }

    @MainActor
    private func connect(_ kid: Kid) async {
        loadingIds.insert(kid.id)
        defer { loadingIds.remove(kid.id) }
        do {
            _ = try await PathOddsAPI.shared.connect(kidId: kid.id)
            rows[kid.id] = try await PathOddsAPI.shared.today(kidId: kid.id)
        } catch {
            // Keep the row actionable; a future pull-to-refresh retries it.
        }
    }
}
