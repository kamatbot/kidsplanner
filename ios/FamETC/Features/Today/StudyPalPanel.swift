import SwiftUI

/// Child-only Koko panel. It owns only sheet presentation; homework, energy,
/// and corner data remain owned by their established native surfaces.
struct StudyPalPanel: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var textSize

    let ownerID: String
    var usesPopover = false

    private enum Destination: Identifiable {
        case homework(String)
        case energy
        case corner

        var id: String {
            switch self {
            case .homework(let id): "homework-\(id)"
            case .energy: "energy"
            case .corner: "corner"
            }
        }
    }

    @State private var destination: Destination?

    private var isAuthorized: Bool {
        !store.needsAuth && store.me?.role == "kid" && store.me?.id == ownerID
    }

    private var identity: String {
        guard isAuthorized else { return "" }
        return "\(store.me?.id ?? "")|\(store.me?.kidId ?? "")|\(store.family?.id ?? "")"
    }

    private var nextHomework: HomeworkItem? {
        guard let kidID = store.me?.kidId else { return nil }
        return StudyStartPriority.select(from: store.homework.filter { $0.kidId == kidID })
    }

    var body: some View {
        NavigationStack {
            Group {
                if isAuthorized {
                    ScrollView {
                        VStack(alignment: .leading, spacing: Space.md) {
                            header
                            nextHomeworkButton
                            panelButton(
                                title: "Energy check-in",
                                detail: "Choose how your energy feels today",
                                systemImage: "bolt.heart",
                                action: { destination = .energy }
                            )
                            panelButton(
                                title: "My Corner",
                                detail: "A private space for your ideas",
                                systemImage: "square.grid.2x2",
                                action: { destination = .corner }
                            )
                        }
                        .padding(Space.md)
                        .frame(maxWidth: .infinity, alignment: .center)
                    }
                } else {
                    Color.clear
                }
            }
            .background(ScreenBackground())
            .navigationTitle("Koko")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .frame(width: usesPopover ? 400 : nil,
               height: usesPopover ? (textSize.isAccessibilitySize ? 580 : 440) : nil)
        .presentationDetents(textSize.isAccessibilitySize ? [.large] : [.height(480), .large])
        .presentationDragIndicator(usesPopover ? .hidden : .visible)
        .tint(Palette.frYou)
        .onAppear {
            if !isAuthorized { dismiss() }
        }
        .onChange(of: identity) { _, _ in
            destination = nil
            dismiss()
        }
        .sheet(item: $destination) { destination in
            switch destination {
            case .homework(let id): HomeworkDetailSheet(homeworkId: id)
            case .energy: MoodCheckInView()
            case .corner: MyCornerScreen(ownerID: ownerID).id(ownerID)
            }
        }
        .onDisappear { destination = nil }
    }

    private var header: some View {
        HStack(spacing: Space.md) {
            Image("KokoStudyPal")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Space.xs) {
                Text("Let’s take one step")
                    .font(Typography.cardTitle)
                    .foregroundStyle(Palette.frInk)
                Text("Pick one small step.")
                    .font(Typography.body)
                    .foregroundStyle(Palette.frInk2)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Koko study panel. Let’s take one step.")
    }

    @ViewBuilder private var nextHomeworkButton: some View {
        if store.isLoadingHomework && nextHomework == nil {
            ProgressView("Loading your next homework…").frame(minHeight: 64)
        } else if let error = store.homeworkError, nextHomework == nil {
            VStack(alignment: .leading, spacing: Space.sm) {
                Text("Homework couldn’t load").font(Typography.itemTitle)
                Text(error).font(Typography.label).foregroundStyle(Palette.frInk2)
                Button("Try again") { Task { await store.loadCalendarAndHomework(force: true) } }.frame(minHeight: 44)
            }
        } else if let nextHomework {
            panelButton(
                title: "Next homework",
                detail: "\(nextHomework.title) · \(StudyStartPriority.dueText(for: nextHomework))",
                systemImage: "book.closed",
                action: { destination = .homework(nextHomework.id) }
            )
        } else {
            panelButton(
                title: "Next homework",
                detail: "Nothing waiting right now",
                systemImage: "checkmark.circle",
                action: {}
            )
            .disabled(true)
        }
    }

    private func panelButton(
        title: String,
        detail: String,
        systemImage: String,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            HStack(alignment: .top, spacing: Space.md) {
                Image(systemName: systemImage)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(Palette.frYou)
                    .frame(width: 36, height: 36)
                    .background(Palette.frYouSoft, in: Circle())
                VStack(alignment: .leading, spacing: Space.xs) {
                    Text(title)
                        .font(Typography.itemTitle)
                        .foregroundStyle(Palette.frInk)
                    Text(detail)
                        .font(Typography.label)
                        .foregroundStyle(Palette.frInk2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: Space.sm)
                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Palette.frInk2)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(12)
            .background(Palette.frCard2, in: RoundedRectangle(cornerRadius: Radius.field, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("\(title). \(detail)")
    }
}
