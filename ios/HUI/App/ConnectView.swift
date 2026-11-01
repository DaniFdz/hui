// The Connect screen: the gateway's address and why the last attempt failed.
import SwiftUI

struct ConnectView: View {
    @Bindable var gateway: GatewayModel

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Gateway URL", text: $gateway.url, prompt: Text("http://127.0.0.1:4000"))
                        .accessibilityLabel("Gateway URL")
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit(connect)
                } footer: {
                    if case .failed(let message) = gateway.state {
                        Text(message).foregroundStyle(.red)
                    }
                }
                Button(gateway.state == .connecting ? "Connecting…" : "Connect", action: connect)
                    .disabled(gateway.state == .connecting)
            }
            .navigationTitle("Connect to HUI")
        }
    }

    private func connect() {
        Task { await gateway.connect() }
    }
}
