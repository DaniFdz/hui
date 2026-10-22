// When the chat transcript scrolls to its end: following through content changes, a follow that layout moved off the
// bottom going back to it, the reader's own scroll stopping and resuming it, an opened card stopping it and a send
// resuming it, and content no taller than the screen never scrolling.
import Testing
@testable import HUI

struct TranscriptFollowTests {
    @Test func aFollowThatLayoutMovedOffTheBottomGoesBackToIt() {
        var follow = TranscriptFollow()
        #expect(follow.overflowChanged(500))
        #expect(!follow.nearBottomChanged(true))
        #expect(follow.nearBottomChanged(false))
    }

    @Test func theReadersScrollStopsAndResumesFollowing() {
        var follow = TranscriptFollow()
        _ = follow.overflowChanged(500)
        follow.scrollingChanged(true)
        #expect(!follow.nearBottomChanged(false))
        follow.scrollingChanged(false)
        #expect(!follow.overflowChanged(600))
        follow.scrollingChanged(true)
        #expect(!follow.nearBottomChanged(true))
        follow.scrollingChanged(false)
        #expect(follow.overflowChanged(700))
    }

    @Test func anOpenedCardStopsFollowingAndASendResumesIt() {
        var follow = TranscriptFollow()
        _ = follow.overflowChanged(500)
        follow.stop()
        #expect(!follow.overflowChanged(600))
        #expect(!follow.nearBottomChanged(false))
        #expect(follow.follow())
        #expect(follow.overflowChanged(700))
    }

    @Test func contentNoTallerThanTheScreenNeverScrolls() {
        var follow = TranscriptFollow()
        #expect(!follow.overflowChanged(-200))
        #expect(!follow.nearBottomChanged(false))
        #expect(!follow.follow())
    }
}
