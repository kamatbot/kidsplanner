import SwiftUI
import UIKit

/// Pick which of this device's calendars (iCloud, Google, Exchange…) show up
/// in Fam ETC. Every failure shows its exact text on screen.
struct DeviceCalendarSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @State private var sync = DeviceCalendarSync.shared
    @State private var accessError: String?
    @State private var requesting = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(store.isParent
                         ? "Events from the calendars you pick here (including ones Siri adds) are copied onto the family calendar in Fam ETC, and kept up to date when they change or are deleted."
                         : "Events from the calendars you pick here (including ones Siri adds) are copied onto your Fam ETC calendar, and kept up to date when they change or are deleted.")
                        .font(.footnote)
                        .foregroundStyle(Palette.textSecond)
                }

                if !sync.hasFullAccess {
                    Section {
                        if sync.authorization == .notDetermined {
                            Button {
                                Task {
                                    requesting = true
                                    accessError = await sync.requestAccess()
                                    requesting = false
                                    if accessError == nil { await sync.sync() }
                                }
                            } label: {
                                Label(requesting ? "Asking…" : "Allow calendar access", systemImage: "calendar.badge.plus")
                            }
                            .disabled(requesting)
                            .accessibilityIdentifier("deviceCalendar.allow")
                        } else {
                            Text(DeviceCalendarSync.deniedMessage(for: sync.authorization))
                                .foregroundStyle(Palette.red)
                            Button("Open Settings") {
                                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                            }
                        }
                        if let accessError {
                            Text(accessError).font(.footnote).foregroundStyle(Palette.red)
                        }
                    }
                } else {
                    Section {
                        if sync.calendars.isEmpty {
                            Text("No calendars found on this device.")
                                .foregroundStyle(Palette.textSecond)
                        }
                        ForEach(sync.calendars) { cal in
                            Button { sync.toggle(cal.id) } label: {
                                HStack(spacing: Space.sm) {
                                    Circle().fill(Color(uiColor: cal.color)).frame(width: 12, height: 12)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(cal.title).foregroundStyle(Palette.text)
                                        if !cal.account.isEmpty {
                                            Text(cal.account).font(.caption).foregroundStyle(Palette.textSecond)
                                        }
                                    }
                                    Spacer()
                                    if sync.selectedIds.contains(cal.id) {
                                        Image(systemName: "checkmark").foregroundStyle(Palette.accent)
                                    }
                                }
                            }
                            .accessibilityAddTraits(sync.selectedIds.contains(cal.id) ? .isSelected : [])
                        }
                    } header: {
                        Text("Calendars on this \(UIDevice.current.userInterfaceIdiom == .pad ? "iPad" : "iPhone")")
                    } footer: {
                        Text("Turning a calendar off removes the events it added. Covers 2 weeks back to 3 months ahead.")
                    }

                    Section {
                        Button {
                            Task { await sync.sync() }
                        } label: {
                            HStack {
                                Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                                Spacer()
                                if sync.isSyncing { ProgressView() }
                            }
                        }
                        .disabled(sync.isSyncing)
                        if let summary = sync.lastSummary {
                            Text(summary).font(.footnote).foregroundStyle(Palette.textSecond)
                        } else if let last = sync.lastSync {
                            Text("Last synced \(last.formatted(.relative(presentation: .named)))")
                                .font(.footnote).foregroundStyle(Palette.textSecond)
                        }
                        ForEach(sync.lastErrors, id: \.self) { err in
                            Text(err).font(.footnote).foregroundStyle(Palette.red).textSelection(.enabled)
                        }
                    }
                }
            }
            .navigationTitle("Phone calendar")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        Task { await sync.sync() }
                        dismiss()
                    }
                }
            }
            .onAppear { sync.refreshAuthorization() }
        }
    }
}

/// One-line prompt at the top of Calendar until the person turns phone
/// calendar sync on (or dismisses it); also shows sync errors once on.
struct DeviceCalendarBanner: View {
    @State private var sync = DeviceCalendarSync.shared
    @State private var showSheet = false

    var body: some View {
        Group {
            if sync.needsSetup && !sync.bannerDismissed {
                banner(icon: "calendar.badge.plus",
                       text: "Show events from your phone's Calendar (like ones Siri adds) here?",
                       action: "Set up", tint: Palette.accent, dismissible: true)
            } else if sync.isEnabled, let err = sync.lastErrors.first {
                banner(icon: "exclamationmark.triangle.fill", text: err,
                       action: "Details", tint: Palette.red, dismissible: false)
            }
        }
        .sheet(isPresented: $showSheet) { DeviceCalendarSheet() }
    }

    private func banner(icon: String, text: String, action: String, tint: Color, dismissible: Bool) -> some View {
        HStack(spacing: Space.sm) {
            Image(systemName: icon).foregroundStyle(tint)
            Text(text)
                .font(Typography.caption)
                .foregroundStyle(Palette.text)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action) { showSheet = true }
                .font(Typography.caption.weight(.bold))
                .foregroundStyle(tint)
                .accessibilityIdentifier("deviceCalendar.banner")
            if dismissible {
                Button { sync.dismissBanner() } label: {
                    Image(systemName: "xmark").font(.caption.weight(.bold)).foregroundStyle(Palette.textSecond)
                        .frame(width: 32, height: 32)
                }
                .accessibilityLabel("Not now")
            }
        }
        .padding(.horizontal, Space.md)
        .padding(.vertical, Space.sm)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Palette.border))
        .padding(.horizontal, Space.md)
        .padding(.top, Space.sm)
    }
}

/// Row for the add-event sheets: opens the phone calendar settings.
struct DeviceCalendarRow: View {
    @State private var sync = DeviceCalendarSync.shared
    @State private var showSheet = false

    var body: some View {
        Button { showSheet = true } label: {
            HStack {
                Label("Phone calendar", systemImage: "calendar")
                Spacer()
                Text(sync.isEnabled ? "\(sync.selectedIds.count) on" : "Off")
                    .foregroundStyle(Palette.textSecond)
            }
        }
        .accessibilityIdentifier("deviceCalendar.row")
        .sheet(isPresented: $showSheet) { DeviceCalendarSheet() }
    }
}
