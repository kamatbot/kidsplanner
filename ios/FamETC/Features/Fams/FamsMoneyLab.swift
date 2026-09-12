import SwiftUI

struct FamsProjection: Equatable {
    struct Point: Equatable, Identifiable {
        let year: Int
        let total: Double
        let contributions: Double
        var id: Int { year }
    }
    let total: Double
    let contributions: Double
    let growth: Double
    let series: [Point]

    static func calculate(principal: Double, monthlyContribution: Double, annualRate: Double, years: Int) -> FamsProjection? {
        guard principal.isFinite, monthlyContribution.isFinite, annualRate.isFinite,
              (0...10_000_000).contains(principal), (0...1_000_000).contains(monthlyContribution),
              (-50...30).contains(annualRate), (1...50).contains(years) else { return nil }
        // Match the server's monthly growth followed by the month's contribution.
        func cents(_ value: Double) -> Double { floor(value * 100 + 0.5) / 100 }
        let rate = annualRate / 1200
        var total = principal
        var series = [Point(year: 0, total: cents(total), contributions: cents(principal))]
        for month in 1...(years * 12) {
            total = total * (1 + rate) + monthlyContribution
            if month.isMultiple(of: 12) {
                series.append(Point(year: month / 12, total: cents(total), contributions: cents(principal + monthlyContribution * Double(month))))
            }
        }
        let contributions = principal + monthlyContribution * Double(years * 12)
        return FamsProjection(total: cents(total), contributions: cents(contributions), growth: cents(total - contributions), series: series)
    }
}

struct FamsMoneyLab: View {
    @Environment(\.dismiss) private var dismiss
    @State private var principal: String
    @State private var monthly = "50"
    @State private var rate = 5.0
    @State private var years = 5

    init(initialBalance: Double) {
        _principal = State(initialValue: String(initialBalance))
    }
    private var projection: FamsProjection? {
        guard let principal = Double(principal), let monthly = Double(monthly) else { return nil }
        return FamsProjection.calculate(principal: principal, monthlyContribution: monthly, annualRate: rate, years: years)
    }
    var body: some View {
        Form {
            Section {
                if let projection {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("After \(years) \(years == 1 ? "year" : "years")").font(Typography.label)
                        Text("\(famsAmount(projection.total)) fams").font(Typography.title).foregroundStyle(Palette.accent)
                        Text("You put in \(famsAmount(projection.contributions)) fams").font(Typography.body)
                        Text("Hypothetical growth: \(famsAmount(projection.growth)) fams").font(Typography.body)
                    }.padding(.vertical, 6).accessibilityElement(children: .combine)
                } else {
                    Text("Enter starting savings from 0 to 10,000,000 fams and monthly savings from 0 to 1,000,000 fams.").foregroundStyle(Palette.textSecond)
                }
            } header: { Text("Explore a possibility") } footer: {
                Text("1 fam = ฿1. This is a hypothetical example. Returns are not guaranteed; real values can fall. It does not change your wallet.")
            }
            Section("Try your own numbers") {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Starting savings (fams)").font(Typography.label)
                    TextField("Starting savings", text: $principal).keyboardType(.decimalPad).accessibilityLabel("Starting savings in fams")
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Save each month (fams)").font(Typography.label)
                    TextField("Monthly saving", text: $monthly).keyboardType(.decimalPad).accessibilityLabel("Monthly saving in fams")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("Hypothetical yearly return: \(rate.formatted(.number.precision(.fractionLength(0...1))))%").font(Typography.label)
                    Slider(value: $rate, in: -50...30, step: 0.5)
                        .accessibilityLabel("Hypothetical annual return")
                        .accessibilityValue("\(rate.formatted()) percent")
                }
                Stepper("\(years) \(years == 1 ? "year" : "years")", value: $years, in: 1...50)
                    .accessibilityLabel("Time in years").accessibilityValue(String(years))
            }
            if let projection {
                Section {
                    let maximum = max(1, projection.series.map(\.total).max() ?? 0)
                    ForEach(projection.series) { point in
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Year \(point.year): \(famsAmount(point.total)) fams").font(Typography.caption)
                            GeometryReader { geometry in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Palette.accentSoft)
                                    Capsule().fill(Palette.accent).frame(width: geometry.size.width * point.total / maximum)
                                }
                            }.frame(height: 10).accessibilityHidden(true)
                        }.padding(.vertical, 3).accessibilityElement(children: .combine)
                    }
                } header: { Text("Year by year") } footer: {
                    Text("The example applies growth monthly, then adds your monthly saving. It assumes a steady rate and excludes fees and inflation.")
                }
            }
        }
        .font(Typography.body).tint(Palette.accent)
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Money lab").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }
}
