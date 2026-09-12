import SwiftUI

struct FamsHomeCard: View {
    @Environment(AppStore.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var wallets: [String: FamsWallet] = [:]
    @State private var error = false
    @State private var refreshVersion = 0
    @State private var selected: Kid?
    @State private var showJourney = false
    private var identity: String { "\(app.me?.id ?? "")|\(app.family?.id ?? "")|\(app.me?.kidId ?? "")|\(app.me?.role ?? "")" }
    @Environment(\.dynamicTypeSize) private var typeSize
    private var children: [Kid] { (app.family?.kids ?? []).filter { app.isParent || $0.id == app.me?.kidId } }

    var body: some View {
        VStack(alignment: .leading, spacing: Space.md) {
            HStack {
                Text(app.isParent ? "Children & rewards" : "Your fams").font(Typography.cardTitle)
                Spacer()
                Text("1 fam = ฿1").font(Typography.caption).foregroundStyle(Palette.textSecond)
            }
            if children.isEmpty {
                Text("Add a child in Settings to get started.").font(Typography.body).foregroundStyle(Palette.textSecond)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .leading), count: app.isParent && children.count > 1 && sizeClass == .regular && !typeSize.isAccessibilitySize ? 2 : 1), alignment: .leading, spacing: Space.md) {
                ForEach(children) { kid in
                    Button {
                        if app.isParent { selected = kid } else { showJourney = true }
                    } label: {
                        HStack(spacing: Space.md) {
                            if app.isParent { KidProfileAvatar(kid: kid, size: 40) }
                            else { FamsCoin(trigger: 0, compact: true) }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(app.isParent ? kid.name : "Small steps, big possibilities").font(Typography.label)
                                if let wallet = wallets[kid.id] {
                                    Text("\(famsAmount(wallet.balance)) fams").font(Typography.display(25, .semibold)).monospacedDigit()
                                        .contentTransition(.numericText())
                                    ProgressView(value: wallet.weeklyFraction).tint(Palette.accent)
                                    Text("\(famsAmount(wallet.weekly.earned)) / \(famsAmount(wallet.weekly.limit)) this week").font(Typography.caption).foregroundStyle(Palette.textSecond)
                                } else { Text(error ? "Tap to open rewards" : "Loading rewards…").font(Typography.caption) }
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.accent)
                        }
                        .foregroundStyle(Palette.text).frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Space.md).background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: 14))
                    }.buttonStyle(PressableStyle())
                }
            }
        }
        .padding(Space.lg).background(Palette.panel, in: RoundedRectangle(cornerRadius: Radius.card))
        .task(id: identity) { await refresh() }
        .onChange(of: app.homework.map { "\($0.id):\($0.status)" }) { _, _ in Task { await refresh() } }
        .onReceive(NotificationCenter.default.publisher(for: .famsRewardsChanged)) { _ in Task { await refresh() } }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await refresh() } } }

        .sheet(item: $selected, onDismiss: { Task { await refresh() } }) { kid in
            NavigationStack {
                HybridWebView(path: childPath(kid.id), isEmbedded: true)
                    .navigationTitle(kid.name)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { selected = nil } } }
            }.id(identity)
        }
        .fullScreenCover(isPresented: $showJourney, onDismiss: { Task { await refresh() } }) {
            if let kid = children.first {
                NavigationStack { FamsJourneyScreen(kidId: kid.id, name: kid.name).environment(app) }.id(identity)
            }
        }
        .onChange(of: identity) { _, _ in selected = nil; showJourney = false; wallets = [:] }
    }
    private func childPath(_ id: String) -> String {
        var components = URLComponents()
        components.path = "/"
        components.queryItems = [URLQueryItem(name: "child", value: id)]
        return components.string ?? "/"
    }
    private func refresh() async {
        let scope = identity; refreshVersion += 1; let version = refreshVersion; error = false
        for kid in children {
            do {
                let wallet = try await APIClient.shared.famsWallet(kidId: kid.id)
                guard identity == scope, version == refreshVersion, !Task.isCancelled, wallet.kidId == kid.id else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25)) { wallets[kid.id] = wallet }
            } catch { if identity == scope { self.error = true } }
        }
    }
}

struct FamsJourneyScreen: View {
    let kidId: String
    let name: String
    @Environment(AppStore.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var model: FamsStore
    @State private var lesson: FamsLesson?
    @State private var showGoal = false
    @State private var showCalculator = false
    @State private var owner = ""
    init(kidId: String, name: String, service: any FamsService = APIClient.shared) {
        self.kidId = kidId; self.name = name; _model = State(initialValue: FamsStore(service: service))
    }
    private var validSession: Bool { app.me?.id == owner && app.me?.kidId == kidId && !app.isParent }
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                Group {
                    if let wallet = model.wallet {
                        if geometry.size.width >= 1000 && !typeSize.isAccessibilitySize {
                            HStack(alignment: .top, spacing: 18) {
                                VStack(spacing: 12) {
                                    walletHero(wallet)
                                    savings(wallet)
                                    chores(wallet)
                                }.frame(width: min(380, geometry.size.width * 0.33))
                                VStack(alignment: .leading, spacing: 20) {
                                    statusFeedback
                                    lessonTrail(columns: 3)
                                    moneyLab
                                    history(wallet)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                            }
                        } else {
                            VStack(alignment: .leading, spacing: 12) {
                                walletHero(wallet)
                                statusFeedback
                                ViewThatFits(in: .horizontal) {
                                    if !typeSize.isAccessibilitySize {
                                        HStack(alignment: .top, spacing: 18) {
                                            savings(wallet).frame(minWidth: 300)
                                            chores(wallet).frame(minWidth: 300)
                                        }
                                    }
                                    VStack(spacing: 12) { savings(wallet); chores(wallet) }
                                }
                                lessonTrail(columns: geometry.size.width >= 650 ? 3 : 2)
                                moneyLab
                                history(wallet)
                            }
                        }
                    } else if model.loading {
                        ProgressView("Loading your fams…").frame(maxWidth: .infinity).padding(40)
                    } else { errorView(model.error ?? "Your rewards couldn’t be loaded.") }
                }
                .padding(16).frame(maxWidth: 1320).frame(maxWidth: .infinity)
            }
        }
        .background(Palette.bg).foregroundStyle(Palette.text)
        .navigationTitle("Fams").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        .task(id: app.me?.id) {
            owner = app.me?.id ?? ""
            guard validSession else { model.clear(); dismiss(); return }
            await model.load(kidId: kidId)
        }
        .onChange(of: app.me?.id) { _, _ in model.clear(); dismiss() }
        .onChange(of: app.me?.kidId) { _, _ in model.clear(); dismiss() }
        .onChange(of: app.me?.role) { _, _ in model.clear(); dismiss() }
        .refreshable { if validSession && !model.saving { await model.load(kidId: kidId) } }
        .sheet(item: $lesson) { selected in
            NavigationStack { FamsLessonScreen(lesson: selected, model: model, kidId: kidId, isCurrent: { validSession }) }
        }
        .sheet(isPresented: $showGoal) {
            NavigationStack { FamsGoalEditor(model: model, kidId: kidId, isCurrent: { validSession }) }
        }
        .sheet(isPresented: $showCalculator) {
            NavigationStack {
                FamsMoneyLab(initialBalance: model.wallet?.balance ?? 0)
            }
        }
    }
    @ViewBuilder private var statusFeedback: some View {
        if let feedback = model.feedback {
            Label(feedback, systemImage: "checkmark.circle.fill").font(Typography.body)
                .foregroundStyle(Palette.green).accessibilityAddTraits(.updatesFrequently)
        }
        if let error = model.error { errorView(error) }
    }
    private var moneyLab: some View {
        Button { showCalculator = true } label: {
            HStack(spacing: 14) {
                FamsArtwork(tile: 4).frame(width: 76, height: 76).clipShape(RoundedRectangle(cornerRadius: 12))
                VStack(alignment: .leading, spacing: 4) {
                    Text("Money lab").font(Typography.cardTitle)
                    Text("See what your savings could become").font(Typography.label).foregroundStyle(Palette.textSecond)
                }
                Spacer()
                Image(systemName: "arrow.up.right").foregroundStyle(Palette.accent)
            }.padding(18).frame(maxWidth: .infinity, minHeight: 70)
                .background(Palette.accent.opacity(0.1), in: RoundedRectangle(cornerRadius: 22))
        }.buttonStyle(PressableStyle()).foregroundStyle(Palette.text)
    }
    private func history(_ wallet: FamsWallet) -> some View {
        DisclosureGroup("Every fam has a story") {
            Text("School house points earn 50 fams each, outside your weekly rewards limit.").font(Typography.caption).foregroundStyle(Palette.textSecond)
            if wallet.transactions.isEmpty { Text("Your first reward will appear here.").font(Typography.body) }
            ForEach(wallet.transactions.prefix(15)) { transaction in
                HStack {
                    Text(transaction.reason).font(Typography.label)
                    Spacer()
                    Text("+\(famsAmount(transaction.amount))").font(Typography.body.weight(.semibold)).monospacedDigit()
                }.padding(.vertical, 8)
            }
        }.font(Typography.body).tint(Palette.accent)
    }
    private func errorView(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(message).font(Typography.body).foregroundStyle(Palette.textSecond)
            Button("Try again") { Task { if validSession { await model.load(kidId: kidId) } } }.disabled(model.loading)
        }
    }
    private func walletHero(_ wallet: FamsWallet) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Your balance").font(Typography.label)
                    Text(famsAmount(wallet.balance)).font(Typography.display(34, .bold)).monospacedDigit()
                        .contentTransition(.numericText())
                    Text("fams · 1 fam = ฿1").font(Typography.label)
                }.frame(maxWidth: .infinity, alignment: .leading)
                if !typeSize.isAccessibilitySize {
                    FamsArtwork(tile: 0).frame(width: 76, height: 76)
                        .clipShape(RoundedRectangle(cornerRadius: 18))
                        .scaleEffect(model.celebration.isMultiple(of: 2) ? 1 : 1.04)
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("This week").font(Typography.label.weight(.semibold))
                    Spacer()
                    Text("\(famsAmount(wallet.weekly.earned)) / \(famsAmount(wallet.weekly.limit))").font(Typography.label).monospacedDigit()
                }
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.2))
                        Capsule().fill(Palette.coral).frame(width: geometry.size.width * wallet.weeklyFraction)
                    }
                }.frame(height: 12)
                    .animation(reduceMotion ? nil : .spring(duration: 0.7), value: wallet.weeklyFraction)
                    .accessibilityLabel("Weekly rewards").accessibilityValue("\(famsAmount(wallet.weekly.earned)) of \(famsAmount(wallet.weekly.limit)) fams")
                HStack {
                    ForEach(0..<4) { step in
                        if step > 0 { Spacer() }
                        Text(famsAmount(wallet.weekly.limit * Double(step) / 3))
                            .font(Typography.caption).monospacedDigit()
                    }
                }.accessibilityHidden(true)
            }
            Text("Chores and school points are extra.").font(Typography.caption).foregroundStyle(.white.opacity(0.85))
        }
        .foregroundStyle(.white).padding(16)
        .background {
            ZStack(alignment: .topTrailing) {
                Color(hex: 0x6233BC)
                Circle().fill(Color(hex: 0x8050D6)).frame(width: 230, height: 230).offset(x: 90, y: -100)
                Circle().stroke(.white.opacity(0.12), lineWidth: 24).frame(width: 190, height: 190).offset(x: 60, y: -90)
            }.clipShape(RoundedRectangle(cornerRadius: 26))
        }
        .animation(reduceMotion ? nil : .spring(duration: 0.5), value: wallet.balance)
    }
    private func savings(_ wallet: FamsWallet) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("My next goal").font(Typography.cardTitle)
                Spacer(minLength: 8)
                Button(wallet.goal == nil ? "Set goal" : "Edit") { showGoal = true }
                    .font(Typography.label).frame(minWidth: 44, minHeight: 44)
                    .contentShape(Rectangle()).tint(Palette.accent)
            }
            HStack(spacing: 12) {
                if !typeSize.isAccessibilitySize {
                    FamsArtwork(tile: 1).frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                VStack(alignment: .leading, spacing: 6) {
                    if let goal = wallet.goal {
                        Text(goal.name).font(Typography.body.weight(.medium))
                        Text("\(famsAmount(wallet.balance)) / \(famsAmount(goal.target)) fams")
                            .font(Typography.caption).foregroundStyle(Palette.textSecond).monospacedDigit()
                        ProgressView(value: wallet.goalFraction).tint(Palette.accent)
                            .animation(reduceMotion ? nil : .easeOut(duration: 0.4), value: wallet.goalFraction)
                        Text(wallet.goalFraction >= 1 ? "Goal reached — plan your next step with a parent." : "\(famsAmount(max(0, goal.target - wallet.balance))) fams to go")
                            .font(Typography.caption)
                    } else {
                        Text("What would you love to save for?").font(Typography.body)
                    }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).famsPanel()
    }
    private func chores(_ wallet: FamsWallet) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Earn extra").font(Typography.cardTitle).foregroundStyle(Palette.orangeInk)
            if wallet.chores.filter({ $0.status != "approved" }).isEmpty {
                HStack(spacing: 14) {
                    FamsArtwork(tile: 3).frame(width: 64, height: 64).clipShape(RoundedRectangle(cornerRadius: 12))
                    Text("Ask a parent for a job you can help with.").font(Typography.body)
                }
            }
            ForEach(wallet.chores.filter { $0.status != "approved" }) { chore in
                VStack(alignment: .leading, spacing: 6) {
                    HStack { Text(chore.title).font(Typography.body); Spacer(); Text("+\(famsAmount(chore.amount))").font(Typography.body.weight(.semibold)).foregroundStyle(Palette.orangeInk).padding(8).background(Palette.orange.opacity(0.12), in: Capsule()) }
                    if chore.status == "submitted" { Label("Waiting for your parent", systemImage: "clock").font(Typography.caption) }
                    else { Button("Mark done") { Task { if validSession { await model.submit(chore, kidId: kidId) } } }.buttonStyle(.bordered).controlSize(.large).tint(Palette.accent).disabled(model.saving) }
                }
            }
        }.frame(maxWidth: .infinity, alignment: .leading).famsPanel(tint: Palette.orange)
    }
    private let topics: [(title: String, detail: String, tile: Int, ids: [String])] = [
        ("Saving", "Keep a little for later.", 1, ["goal", "buffer"]),
        ("Needs & wants", "Choose what matters.", 2, ["needs", "tradeoff"]),
        ("Planning", "Give your money a plan.", 3, ["budget", "horizon", "inflation"]),
        ("Compounding", "See how growth adds up.", 4, ["interest", "compound", "time"]),
        ("Investing", "Explore the possibilities.", 5, ["risk", "diversify", "fees", "scams"])
    ]
    private func lessonTrail(columns: Int) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your money trail").font(Typography.cardTitle)
            Text("Learn a little. Try it in real life.").font(Typography.body).foregroundStyle(Palette.textSecond)
            if model.lessons.isEmpty { Text("Pull to refresh your lessons.").font(Typography.label) }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), alignment: .top), count: typeSize.isAccessibilitySize ? 1 : columns), alignment: .leading, spacing: 16) {
                ForEach(topics.indices, id: \.self) { index in
                    let topic = topics[index]
                    let items = model.lessons.filter { topic.ids.contains($0.id) }
                    if let next = items.first(where: { !$0.completed }) ?? items.first {
                        let completed = items.filter(\.completed).count
                        Button { lesson = next } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                FamsArtwork(tile: topic.tile).frame(height: columns == 3 ? 120 : 96).frame(maxWidth: .infinity)
                                    .clipShape(RoundedRectangle(cornerRadius: 14))
                                    .overlay(alignment: .bottomTrailing) {
                                        if completed == items.count {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.system(size: 25)).symbolRenderingMode(.palette)
                                                .foregroundStyle(.white, Palette.green).padding(6)
                                        }
                                    }
                                Text(topic.title).font(Typography.body.weight(.semibold))
                                Text(topic.detail).font(Typography.caption).foregroundStyle(Palette.textSecond)
                                HStack {
                                    Text(completed == items.count ? "Revisit" : completed > 0 ? "Continue" : "Start")
                                    Spacer()
                                    Text("\(completed)/\(items.count)").monospacedDigit()
                                    Image(systemName: "arrow.right")
                                }.font(Typography.label).foregroundStyle(Palette.accent)
                                    .frame(minHeight: 44)
                            }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }.buttonStyle(PressableStyle(scale: 0.98)).foregroundStyle(Palette.text)
                            .accessibilityLabel("\(topic.title), \(completed) of \(items.count) lessons complete")
                    }
                }
            }
            Text("Earn 2 fams for one new lesson each day.").font(Typography.caption).foregroundStyle(Palette.textSecond)
            DisclosureGroup("All lessons") {
                ForEach(model.lessons) { item in
                    Button { lesson = item } label: {
                        HStack {
                            Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                            Text(item.title).multilineTextAlignment(.leading)
                            Spacer()
                            Image(systemName: "chevron.right")
                        }.font(Typography.label).frame(minHeight: 44)
                    }.buttonStyle(.plain).foregroundStyle(Palette.accent)
                }
            }.font(Typography.label).tint(Palette.accent)
        }.padding(18).background(Palette.panel, in: RoundedRectangle(cornerRadius: 18))
    }
}

private extension View {
    func famsPanel(tint: Color = Palette.accent) -> some View {
        padding(14).background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(tint.opacity(0.2), lineWidth: 1))
    }
}

struct FamsCoin: View {
    let trigger: Int
    var compact = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        ZStack {
            Circle().fill(Color(hex: 0xFFD66B))
            Circle().stroke(Color(hex: 0xE7A62B), lineWidth: 2).padding(6)
            Text("F").font(Typography.display(compact ? 26 : 46, .bold))
                .foregroundStyle(Color(hex: 0x704212))
        }
        .frame(width: compact ? 48 : 86, height: compact ? 48 : 86)
        .phaseAnimator(reduceMotion ? [false] : [false, true, false], trigger: trigger) { content, lifted in
            content.scaleEffect(lifted ? 1.13 : 1).rotationEffect(.degrees(lifted ? -9 : 0)).offset(y: lifted ? -7 : 0)
        } animation: { _ in .spring(duration: 0.35, bounce: 0.35) }
        .accessibilityHidden(true)
    }
}

/// A single bundled atlas is sliced once; each illustration remains decorative.
private struct FamsArtwork: View {
    let tile: Int
    private static let images: [UIImage] = {
        guard let source = UIImage(named: "FamsArtwork")?.cgImage else { return [] }
        let side = source.width / 3
        return (0..<6).compactMap { index in
            source.cropping(to: CGRect(x: (index % 3) * side, y: (index / 3) * side, width: side, height: side))
                .map { UIImage(cgImage: $0) }
        }
    }()
    var body: some View {
        if Self.images.indices.contains(tile) {
            Image(uiImage: Self.images[tile]).resizable().scaledToFit().accessibilityHidden(true)
        }
    }
}
