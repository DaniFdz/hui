// Whether the chat transcript follows its bottom, as the web's does: it follows while the reader's own scroll leaves it
// within 48 points of the end, stops when a card opens, and follows again on a send. Each change answers whether to
// scroll to the end now. Only content taller than the screen scrolls, and a follow that layout moved off the bottom
// (a lazy row's height settling, a row removed) goes back to it.
import Foundation

struct TranscriptFollow {
    private var following = true
    private var userScrolling = false
    private var overflowing = false

    mutating func overflowChanged(_ overflow: CGFloat) -> Bool {
        overflowing = overflow > 0
        return following && overflowing
    }

    mutating func nearBottomChanged(_ near: Bool) -> Bool {
        if userScrolling { following = near }
        return following && !userScrolling && overflowing && !near
    }

    mutating func scrollingChanged(_ scrolling: Bool) {
        userScrolling = scrolling
    }

    mutating func follow() -> Bool {
        following = true
        return !userScrolling && overflowing
    }

    mutating func stop() {
        following = false
    }
}
