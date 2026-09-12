import SwiftUI

struct FamsLessonScreen: View {
    let lesson: FamsLesson
    let model: FamsStore
    let kidId: String
    let isCurrent: () -> Bool
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selected: String?
    @State private var result: FamsAnswer?
    @State private var burst = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    FamsCoin(trigger: result?.correct == true ? 1 : 0, compact: true)
                    Text(lesson.completed ? "Practice makes progress" : "One small money lesson").font(Typography.label).foregroundStyle(Palette.textSecond)
                }
                Text(lesson.title).font(Typography.largeTitle)
                Text(lesson.body).font(Typography.body).lineSpacing(5)
                Divider()
                Text(lesson.question).font(Typography.title)
                ForEach(lesson.options) { option in
                    Button {
                        selected = option.id; result = nil
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: selected == option.id ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(selected == option.id ? Palette.accent : Palette.textSecond)
                            Text(option.text).font(Typography.body.weight(.medium)).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                        .padding(16).frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                        .background(selected == option.id ? Palette.accentSoft : Palette.panel, in: RoundedRectangle(cornerRadius: 16))
                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(selected == option.id ? Palette.accent : Palette.border, lineWidth: selected == option.id ? 2 : 1))
                    }.buttonStyle(PressableStyle(scale: 0.98))
                        .disabled(model.saving || result?.correct == true)
                        .accessibilityAddTraits(selected == option.id ? .isSelected : [])
                }
                if let result {
                    VStack(alignment: .leading, spacing: 10) {
                        Label(result.correct ? "You’ve got it!" : "Let’s try that again", systemImage: result.correct ? "checkmark.seal.fill" : "arrow.counterclockwise")
                            .font(Typography.cardTitle)
                        if result.correct, let awarded = result.awarded, awarded > 0 {
                            Text("+\(famsAmount(awarded)) fams").font(Typography.display(30, .bold)).contentTransition(.numericText())
                        } else if result.correct {
                            Text("Lesson complete. No extra fams awarded this time.").font(Typography.label)
                        }
                        Text(result.explanation).font(Typography.body)
                    }.padding(18).frame(maxWidth: .infinity, alignment: .leading)
                        .background((result.correct ? Palette.teal : Palette.orange).opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
                        .transition(.opacity.combined(with: reduceMotion ? .identity : .offset(y: 10)))
                        .accessibilityElement(children: .combine)
                }
                if let error = model.error { Text(error).font(Typography.body).foregroundStyle(Palette.textSecond) }
                Button {
                    if result?.correct == true { dismiss(); return }
                    guard let selected, isCurrent() else { return }
                    Task {
                        let answer = await model.answer(lesson, option: selected, kidId: kidId)
                        guard isCurrent() else { dismiss(); return }
                        withAnimation(reduceMotion ? nil : .spring(duration: 0.4)) { result = answer }
                        if answer?.correct == true, (answer?.awarded ?? 0) > 0 {
                            Haptics.notify(.success)
                            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.8)) { burst = true }
                        }
                    }
                } label: {
                    HStack { if model.saving { ProgressView().tint(Palette.onAccent) }; Text(result?.correct == true ? "Back to trail" : "Check my answer") }
                        .font(Typography.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 52)
                        .background(Palette.accent, in: RoundedRectangle(cornerRadius: 16)).foregroundStyle(Palette.onAccent)
                }.buttonStyle(PressableStyle()).disabled(selected == nil || model.saving)
            }.padding(20).frame(maxWidth: 660).frame(maxWidth: .infinity)
        }
        .overlay(alignment: .top) {
            if !reduceMotion {
                ZStack {
                    ForEach(0..<10) { index in
                        Image(systemName: index.isMultiple(of: 2) ? "sparkle" : "circle.fill")
                            .font(.system(size: index.isMultiple(of: 2) ? 20 : 7)).foregroundStyle(Palette.accent)
                            .offset(x: burst ? CGFloat(index - 5) * 30 : 0, y: burst ? CGFloat(50 + (index % 3) * 45) : 0)
                            .opacity(burst ? 0 : 0.9).scaleEffect(burst ? 1.2 : 0)
                    }
                }.allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .background(Palette.bg).foregroundStyle(Palette.text)
        .navigationTitle("Money trail").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        .interactiveDismissDisabled(model.saving)
    }
}

struct FamsGoalEditor: View {
    let model: FamsStore
    let kidId: String
    let isCurrent: () -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var amount = ""
    private var target: Int? { Int(amount).flatMap { (1...1_000_000_000).contains($0) ? $0 : nil } }
    var body: some View {
        Form {
            Section {
                TextField("What are you saving for?", text: $name).accessibilityLabel("Savings goal")
                TextField("Target in fams", text: $amount).keyboardType(.numberPad).accessibilityLabel("Target in fams")
            } header: { Text("Choose your next goal") } footer: { Text("1 fam = ฿1. Choose a whole-number target. Your balance stays yours; setting a goal doesn’t spend it.") }
            if let error = model.error { Text(error).foregroundStyle(Palette.textSecond) }
            Button {
                guard let target, isCurrent() else { return }
                Task { if await model.saveGoal(kidId: kidId, name: name.trimmingCharacters(in: .whitespacesAndNewlines), target: target) { dismiss() } }
            } label: { HStack { Text("Save goal"); if model.saving { ProgressView() } } }
                .disabled(target == nil || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.saving)
        }.font(Typography.body).tint(Palette.accent)
            .navigationTitle("Savings goal").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .interactiveDismissDisabled(model.saving)
            .onAppear {
                name = model.wallet?.goal?.name ?? ""
                amount = model.wallet?.goal.map { String(Int($0.target)) } ?? ""
            }
    }
}
