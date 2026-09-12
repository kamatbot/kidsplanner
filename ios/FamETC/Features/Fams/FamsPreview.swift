#if DEBUG
import SwiftUI

/// Offline simulator fixture. Never included in distribution builds.
@MainActor final class FamsPreviewService: FamsService {
    var awarded = false
    var completed: Set<String> = ["goal", "needs"]
    var goal: FamsWallet.Goal? = .init(name: "My first skateboard", target: 900)
    var submitted = false
    func famsWallet(kidId: String) async throws -> FamsWallet {
        FamsWallet(kidId: kidId, isParent: false, balance: awarded ? 682 : 680, totalEarned: 680,
            weekly: .init(earned: awarded ? 182 : 180, limit: 300, weekStart: "2026-09-07"), goal: goal,
            schoolPoints: .init(current: 10, highWater: 10, resetPending: false),
            chores: [.init(id: "tidy", title: "Tidy my bookshelf", amount: 30, status: submitted ? "submitted" : "pending")],
            transactions: [.init(id: "school", amount: 500, reason: "School house points", createdAt: "2026-09-12")], completedLessons: [])
    }
    func famsLessons(kidId: String) async throws -> [FamsLesson] {
        let data = Data(#"""
{"lessons": [{"id": "needs", "title": "Needs before wants", "body": "A need helps you live and learn, like lunch. A want is something enjoyable, like a new game. Planning for needs first helps your money last.", "question": "Which should come first in your budget?", "options": [{"id": "0", "text": "Lunch for school"}, {"id": "1", "text": "A new game"}, {"id": "2", "text": "Another toy"}], "completed": true}, {"id": "goal", "title": "Give your savings a job", "body": "A clear goal has a name, a cost and a date. Saving 50 fams each week toward a 300-fam goal takes six weeks, if you do not spend those savings.", "question": "At 50 fams a week, how long to save 300?", "options": [{"id": "0", "text": "3 weeks"}, {"id": "1", "text": "6 weeks"}, {"id": "2", "text": "30 weeks"}], "completed": true}, {"id": "budget", "title": "Make a spending plan", "body": "A budget is a plan for money coming in and going out. You can choose how much to save, spend and share before you spend anything.", "question": "You have 100 fams and save 30. What remains?", "options": [{"id": "0", "text": "130 fams"}, {"id": "1", "text": "30 fams"}, {"id": "2", "text": "70 fams"}], "completed": false}, {"id": "tradeoff", "title": "Every choice has a trade-off", "body": "Money spent today cannot also go toward another goal. The next-best choice you give up is called an opportunity cost.", "question": "You buy a toy with your bike savings. What is the trade-off?", "options": [{"id": "0", "text": "The bike goal may take longer"}, {"id": "1", "text": "The bike becomes free"}, {"id": "2", "text": "Your savings increase"}], "completed": false}, {"id": "buffer", "title": "Keep a little cushion", "body": "An emergency cushion is money set aside for unexpected needs. Keeping it easy to reach can help when plans change.", "question": "Where should money for an unexpected need be?", "options": [{"id": "0", "text": "Somewhere you cannot access for years"}, {"id": "1", "text": "Easy to access when needed"}, {"id": "2", "text": "Already spent"}], "completed": false}, {"id": "interest", "title": "Money can earn interest", "body": "Interest is money paid for using money. A savings account may pay you interest. Borrowing money may mean you pay interest to someone else.", "question": "What can happen when you borrow money?", "options": [{"id": "0", "text": "You never repay it"}, {"id": "1", "text": "It always doubles"}, {"id": "2", "text": "You may repay extra interest"}], "completed": false}, {"id": "compound", "title": "Growth can grow too", "body": "Compounding means earning returns on your starting money and on earlier returns. At a hypothetical 10% a year, 100 becomes 110, then 121 if that return happens again.", "question": "Why does the second year add 11, not 10?", "options": [{"id": "0", "text": "The earlier 10 also earns a return"}, {"id": "1", "text": "Money must grow every year"}, {"id": "2", "text": "The first 100 disappears"}], "completed": false}, {"id": "time", "title": "Small steps have time to grow", "body": "Regular saving builds a habit. More time can allow more compounding, but the result depends on returns, fees and whether you keep saving.", "question": "Which is a saving habit you can control?", "options": [{"id": "0", "text": "Tomorrow's market return"}, {"id": "1", "text": "Setting aside money regularly"}, {"id": "2", "text": "The price of every investment"}], "completed": false}, {"id": "risk", "title": "Investing includes risk", "body": "Investing means buying something with the hope it will provide income or become more valuable. Its value can fall, and you can lose money.", "question": "Which statement about investing is true?", "options": [{"id": "0", "text": "Profit is certain"}, {"id": "1", "text": "Prices only rise"}, {"id": "2", "text": "You can lose money"}], "completed": false}, {"id": "diversify", "title": "Spread your eggs", "body": "Diversification means spreading investments across different things. It can reduce the harm of one investment doing badly, but cannot remove all risk.", "question": "What can diversification do?", "options": [{"id": "0", "text": "Reduce dependence on one investment"}, {"id": "1", "text": "Guarantee profit"}, {"id": "2", "text": "Remove every risk"}], "completed": false}, {"id": "horizon", "title": "Match money to the deadline", "body": "Money needed soon has less time to recover from a drop in value. A longer goal may allow more time, but the right risk depends on your situation.", "question": "You need money for next week's trip. What matters most?", "options": [{"id": "0", "text": "Taking the biggest risk"}, {"id": "1", "text": "Keeping it available and stable"}, {"id": "2", "text": "Locking it away for years"}], "completed": false}, {"id": "inflation", "title": "Prices change", "body": "Inflation means prices rise overall. If your money stays the same while prices rise, it buys less. A higher balance does not always mean more buying power.", "question": "A snack rises from 20 to 25 THB. The same 100 THB buys…", "options": [{"id": "0", "text": "More snacks"}, {"id": "1", "text": "The same number"}, {"id": "2", "text": "Fewer snacks"}], "completed": false}, {"id": "fees", "title": "Small fees add up", "body": "Fees are charges for a service. They reduce the money left for you and can reduce future growth. Compare costs and ask an adult to help explain unclear charges.", "question": "What do investment fees do?", "options": [{"id": "0", "text": "Reduce the return you keep"}, {"id": "1", "text": "Guarantee a bigger return"}, {"id": "2", "text": "Create free money"}], "completed": false}, {"id": "scams", "title": "Pause before a promise", "body": "A promise of huge guaranteed returns with no risk is a warning sign. Pause, check reliable information and talk with a trusted adult before sharing money or account details.", "question": "Someone promises to double your money overnight. What next?", "options": [{"id": "0", "text": "Send your password"}, {"id": "1", "text": "Pause and ask a trusted adult"}, {"id": "2", "text": "Pay before the offer expires"}], "completed": false}]}
"""#.utf8)
        var lessons = try JSONDecoder().decode(FamsLessonsResponse.self, from: data).lessons
        for i in lessons.indices { lessons[i].completed = lessons[i].completed || completed.contains(lessons[i].id) }
        return lessons
    }
    func answerFamsLesson(kidId: String, lessonId: String, answerId: String) async throws -> FamsAnswer {
        let answers: [String: String] = ["needs": "0", "goal": "1", "budget": "2", "tradeoff": "0", "buffer": "1", "interest": "2", "compound": "0", "time": "1", "risk": "2", "diversify": "0", "horizon": "1", "inflation": "2", "fees": "0", "scams": "1"]
        let correct = answerId == answers[lessonId], reward = correct && !awarded && !completed.contains(lessonId) ? 2.0 : 0
        if correct { if reward > 0 { awarded = true }; completed.insert(lessonId) }
        return .init(correct: correct, explanation: "Your answer has been checked. Small, thoughtful choices help you manage your money.", awarded: reward)
    }
    func submitFamsChore(kidId: String, choreId: String) async throws { submitted = true }
    func saveFamsGoal(kidId: String, name: String, target: Int) async throws { goal = .init(name: name, target: Double(target)) }
}

struct FamsPreviewRoot: View {
    @State private var store: AppStore = {
        let store = AppStore()
        store.me = User(id: "preview", email: "", name: "Arya", role: "kid", kidId: "arya")
        return store
    }()
    var body: some View {
        NavigationStack { FamsJourneyScreen(kidId: "arya", name: "Arya", service: FamsPreviewService()) }
            .environment(store)
    }
}
#endif
