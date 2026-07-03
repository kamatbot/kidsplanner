import UIKit

/// Minimal offline/error screen with a Retry button, shown when a page fails to
/// load (e.g. no connection on launch).
final class ErrorView: UIView {
    private let onRetry: () -> Void

    init(onRetry: @escaping () -> Void) {
        self.onRetry = onRetry
        super.init(frame: .zero)
        backgroundColor = .systemBackground
        build()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func build() {
        let title = UILabel()
        title.text = "Can’t reach Fam ETC"
        title.font = .preferredFont(forTextStyle: .title2)
        title.textColor = .label
        title.textAlignment = .center

        let subtitle = UILabel()
        subtitle.text = "Check your connection and try again."
        subtitle.font = .preferredFont(forTextStyle: .body)
        subtitle.textColor = .secondaryLabel
        subtitle.textAlignment = .center
        subtitle.numberOfLines = 0

        var config = UIButton.Configuration.filled()
        config.title = "Retry"
        config.cornerStyle = .large
        let button = UIButton(configuration: config, primaryAction: UIAction { [weak self] _ in
            self?.onRetry()
        })

        let stack = UIStackView(arrangedSubviews: [title, subtitle, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -32),
        ])
    }
}
