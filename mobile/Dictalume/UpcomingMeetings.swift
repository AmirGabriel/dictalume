import EventKit
import Foundation

struct MobileCalendarMeeting: Identifiable, Hashable {
    let id: String
    let title: String
    let startsAt: Date
    let endsAt: Date
    let calendarName: String

    var isInProgress: Bool {
        startsAt <= Date() && endsAt > Date()
    }
}

@MainActor
final class UpcomingMeetingsStore: ObservableObject {
    enum Access: Equatable {
        case notRequested
        case connected
        case denied
    }

    @Published private(set) var access: Access = .notRequested
    @Published private(set) var meetings: [MobileCalendarMeeting] = []
    @Published private(set) var errorMessage = ""
    @Published private(set) var isLoading = false

    private let eventStore = EKEventStore()
#if DEBUG
    private let usesPreviewMeetings = ProcessInfo.processInfo.arguments.contains(
        "-dictalumeQACalendarFixture"
    )
#endif

    init() {
#if DEBUG
        if usesPreviewMeetings {
            access = .connected
            let now = Date()
            meetings = [
                MobileCalendarMeeting(
                    id: "qa-current",
                    title: "Product weekly",
                    startsAt: now.addingTimeInterval(-10 * 60),
                    endsAt: now.addingTimeInterval(35 * 60),
                    calendarName: "Work"
                ),
                MobileCalendarMeeting(
                    id: "qa-next",
                    title: "Customer interview · NIX deployment",
                    startsAt: now.addingTimeInterval(90 * 60),
                    endsAt: now.addingTimeInterval(150 * 60),
                    calendarName: "Work"
                )
            ]
            return
        }
#endif
        updateAccess()
    }

    func requestAccess() async {
        isLoading = true
        errorMessage = ""
        defer { isLoading = false }
        do {
            let granted = try await eventStore.requestFullAccessToEvents()
            access = granted ? .connected : .denied
            if granted {
                refresh()
            }
        } catch {
            updateAccess()
            errorMessage = "Calendar access could not be requested. Try again in Settings."
        }
    }

    func refresh() {
#if DEBUG
        if usesPreviewMeetings { return }
#endif
        updateAccess()
        guard access == .connected else {
            meetings = []
            return
        }
        let now = Date()
        let start = now.addingTimeInterval(-30 * 60)
        let end = Calendar.current.date(byAdding: .day, value: 14, to: now)
            ?? now.addingTimeInterval(14 * 24 * 60 * 60)
        let predicate = eventStore.predicateForEvents(
            withStart: start,
            end: end,
            calendars: nil
        )
        var seen = Set<String>()
        meetings = eventStore.events(matching: predicate)
            .filter { !$0.isAllDay && $0.endDate > now }
            .compactMap { event -> MobileCalendarMeeting? in
                let id = event.eventIdentifier ?? event.calendarItemIdentifier
                guard seen.insert(id).inserted else { return nil }
                let title = event.title?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                return MobileCalendarMeeting(
                    id: id,
                    title: title?.isEmpty == false ? String(title!.prefix(160)) : "Calendar meeting",
                    startsAt: event.startDate,
                    endsAt: event.endDate,
                    calendarName: event.calendar?.title ?? "Calendar"
                )
            }
            .sorted { $0.startsAt < $1.startsAt }
            .prefix(50)
            .map { $0 }
    }

    private func updateAccess() {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .fullAccess:
            access = .connected
        case .denied, .restricted, .writeOnly:
            access = .denied
        case .notDetermined:
            access = .notRequested
        @unknown default:
            access = .denied
        }
    }
}
