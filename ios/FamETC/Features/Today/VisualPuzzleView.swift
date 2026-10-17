import SwiftUI

/// A diagram is optional enhancement: the full question remains below it.
/// Explicit matrix columns are preserved, including complete 5×5 path boards.
struct VisualPuzzleView: View {
    let visual: BrainTeaserVisual

    var body: some View {
        if visual.isRenderable {
            Group {
                if let columns = visual.columns {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Space.xs), count: columns), spacing: Space.xs) {
                        tiles
                    }
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: Space.sm)], spacing: Space.sm) {
                        tiles
                    }
                }
            }
            .padding(Space.md)
            .background(Palette.panel2, in: RoundedRectangle(cornerRadius: Radius.field))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(visual.alt)
            .accessibilityIdentifier("reasoning.visual.\(visual.kind)")
        }
    }

    private var tiles: some View {
        ForEach(visual.items.indices, id: \.self) { index in
            let item = visual.items[index]
            Group {
                if let symbol = symbol(for: item) {
                    Image(systemName: symbol).font(.title2.weight(.semibold))
                } else {
                    Text(item).font(Typography.body.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .foregroundStyle(item == "wall" || item == "blocked" ? Palette.textSecond : Palette.accent)
            .frame(maxWidth: .infinity, minHeight: 44)
            .padding(.vertical, Space.xs)
            .padding(.horizontal, 2)
            .background(item == "wall" || item == "blocked" ? Palette.border : Palette.panel,
                        in: RoundedRectangle(cornerRadius: Radius.chip))
        }
    }

    private func symbol(for item: String) -> String? {
        switch item {
        case "circle": "circle"
        case "square": "square"
        case "triangle": "triangle"
        case "star": "star"
        case "moon": "moon"
        case "up": "arrow.up"
        case "right": "arrow.right"
        case "down": "arrow.down"
        case "left": "arrow.left"
        case "wall", "blocked": "xmark"
        case "start": "location.circle"
        case "finish": "flag.checkered"
        case "·": "circle.dotted"
        case "?": "questionmark"
        default: nil
        }
    }
}
