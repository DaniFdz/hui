// The app's entry point: loads the shared core once and shows the root screen, or why the core couldn't load.
import SwiftUI

@main
struct HUIApp: App {
    private let core = Result { try HUICore.bundled() }

    var body: some Scene {
        WindowGroup {
            switch core {
            case .success(let core): RootView(core: core)
            case .failure(let error): Text("HUI could not start: \(String(describing: error))").padding()
            }
        }
    }
}
