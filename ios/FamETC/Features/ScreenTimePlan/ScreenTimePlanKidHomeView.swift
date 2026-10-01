import SwiftUI

// The kid's whole app on the Screen Time plan (docs/SCREEN-TIME-ONLY-PLAN.md §4.2): one screen,
// no tab bar. The existing `ScreenTimeKidCard` states ARE the page — the deal, time left today,
// bedtime, "Ask for more time" (free on this plan: no fams) and "See our deal" — with the
// usage card beside it on regular width (iPad: deal on the left, today's usage on the right).
// A kid never sees alerts, other kids, device lists or anything red (SCREEN-TIME-UX.md §1).

struct ScreenTimePlanKidHomeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.famSignOut) private var signOut
    @State private var waitedLong = false
    @State private var confirmSignOut = false
    private var service: ScreenTimeService { .shared }

    /// Same conditions `ScreenTimeKidCard` uses to draw itself: a policy to show, and either
    /// Screen Time on or this device already enrolled.
    private var cardVisible: Bool {
        guard !store.isParent, !store.needsAuth, let policy = service.policy else { return false }
        return policy.enabled || service.isEnrolled
    }

    /// Same conditions `ScreenTimeUsageCard` uses: an enrolled, approved device of this kid.
    private var usageVisible: Bool {
        !store.isParent && !store.needsAuth && service.isEnrolled && service.authState == .approved
            && service.enrolledKidId == store.me?.kidId
    }

    var body: some View {
        PlanPage(maxWidth: sizeClass == .regular && usageVisible ? 1000 : 640) {
            greeting
            if sizeClass == .regular && usageVisible {
                HStack(alignment: .top, spacing: Space.xl) {
                    VStack(alignment: .leading, spacing: Space.lg) { deal }
                        .frame(maxWidth: .infinity, alignment: .top)
                    VStack(alignment: .leading, spacing: Space.lg) { ScreenTimeUsageCard() }
                        .frame(maxWidth: .infinity, alignment: .top)
                }
            } else {
                deal
                ScreenTimeUsageCard()
            }
            signOutButton
        }
        .refreshable { await service.sync(source: "app") }
        .task {
            // Gives the first sync (started by the root) a moment before saying "not set up".
            try? await Task.sleep(for: .seconds(4))
            waitedLong = true
        }
        .confirmationDialog("Sign out of Fam ETC?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { signOut() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A grown-up will need to show you a new code to sign back in.")
        }
        .accessibilityIdentifier("screentimeplan.kidHome")
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: Space.xs) {
            Text("Hi \(DealWords.kidName(store))")
                .font(sizeClass == .regular ? Typography.greetingRegular : Typography.greeting)
                .foregroundStyle(Palette.text)
                .accessibilityAddTraits(.isHeader)
            Text("Your Screen Time")
                .font(Typography.body)
                .foregroundStyle(Palette.textSecond)
        }
    }

    /// The deal card in whatever state it is in, or a calm note while there is nothing to show.
    @ViewBuilder private var deal: some View {
        if cardVisible {
            ScreenTimeKidCard()
        } else {
            Card(padding: Space.lg) {
                VStack(alignment: .leading, spacing: Space.sm) {
                    MicroLabel(text: "Screen Time")
                    if service.policy == nil && !waitedLong {
                        HStack(spacing: Space.sm) {
                            ProgressView()
                            Text("Getting your Screen Time…")
                                .font(Typography.body)
                                .foregroundStyle(Palette.textSecond)
                        }
                    } else {
                        Text("Screen Time isn't on yet. Your grown-ups will set it up with you, and then your deal shows up here.")
                            .font(Typography.body)
                            .foregroundStyle(Palette.textSecond)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("screentimeplan.kidHome.waiting")
            }
        }
    }

    private var signOutButton: some View {
        PlanButton(title: "Sign out", style: .quiet) { confirmSignOut = true }
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.top, Space.md)
            .accessibilityIdentifier("screentimeplan.kidHome.signOut")
    }
}
