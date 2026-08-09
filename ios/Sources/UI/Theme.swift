import SwiftUI
import UIKit

extension Color {
    /// `#RRGGBB` or `#RRGGBBAA`.
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

/// Backgrounds, surfaces and text are the system's own semantic colors —
/// `.systemBackground`, `.label`, and friends — so the app is black/white
/// and automatically correct in light mode, dark mode, and accessibility
/// contrast settings, rather than a hand-picked palette that only really
/// works in one of those. `accent` is the one spot of color, reserved for
/// interactive elements (buttons, toggles, the active tab) — never for
/// backgrounds or body text — matching the web version's own orange
/// (`hsl(28, 90%, 58%)` / `#f97316`, the `accentColor` fallback in
/// `settings.js`).
enum WesaidTheme {
    static let background  = Color(uiColor: .systemBackground)
    static let background2 = Color(uiColor: .secondarySystemBackground)
    static let surface     = Color(uiColor: .secondarySystemBackground)
    static let surface2    = Color(uiColor: .tertiarySystemBackground)

    static let accent = Color(hex: 0xf97316)
    static let accentGlow = Color(hex: 0xf97316, alpha: 0.30)

    static let text1 = Color(uiColor: .label)
    static let text2 = Color(uiColor: .secondaryLabel)
    static let text3 = Color(uiColor: .tertiaryLabel)

    // --r-* corner radii from main.css.
    static let radiusXS: CGFloat = 8
    static let radiusSM: CGFloat = 12
    static let radius: CGFloat = 18
    static let radiusLG: CGFloat = 24
    static let radiusXL: CGFloat = 32
}

extension Font {
    /// The wordmark and section headings use the rounded system design
    /// throughout, echoing the softer, friendlier feel of the web version's
    /// custom display type.
    static func wesaidRounded(_ size: CGFloat, weight: Font.Weight = .bold) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }
}

/// The asymmetric "tail" shape from `.msg-bubble` — sharp on the corner
/// nearest the avatar, rounded everywhere else. `UnevenRoundedRectangle`
/// mirrors CSS's `border-radius: 4px 18px 18px 18px` shorthand exactly.
enum MessageBubbleShape {
    static func bot() -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: 4, bottomLeadingRadius: WesaidTheme.radius,
            bottomTrailingRadius: WesaidTheme.radius, topTrailingRadius: WesaidTheme.radius
        )
    }

    static func user() -> UnevenRoundedRectangle {
        UnevenRoundedRectangle(
            topLeadingRadius: WesaidTheme.radius, bottomLeadingRadius: WesaidTheme.radius,
            bottomTrailingRadius: WesaidTheme.radius, topTrailingRadius: 4
        )
    }
}
