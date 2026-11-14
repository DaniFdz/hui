{
  description = "HUI — browser-first coding-agent gateway";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        rec {
          hui = pkgs.callPackage ./nix/package.nix { };
          hui-desktop = hui.override { withDesktop = true; };
          default = hui;
        }
      );

      nixosModules.default = import ./nix/module.nix { inherit self; };

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.hui}/bin/hui";
          meta.description = "HUI command-line interface and web gateway";
        };
        desktop = {
          type = "app";
          program = toString (
            (pkgsFor system).writeShellScript "hui-desktop" ''
              exec ${self.packages.${system}.hui-desktop}/bin/hui desktop "$@"
            ''
          );
          meta.description = "HUI Electron application";
        };
      });

      checks = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          desktop =
            pkgs.runCommand "hui-desktop-smoke"
              {
                nativeBuildInputs = [
                  pkgs.nodejs_24
                  pkgs.xvfb-run
                ];
              }
              ''
                timeout 90s xvfb-run -a -s "-screen 0 1600x1000x24" node ${./nix/desktop-smoke.mjs} ${self.packages.${system}.hui-desktop} ${
                  self.packages.${system}.hui-desktop.electronPackage
                }/bin
                touch "$out"
              '';
          module = import ./nix/module-check.nix { inherit self pkgs; };
          configured = pkgs.runCommand "hui-configured-smoke" { nativeBuildInputs = [ pkgs.nodejs_24 ]; } ''
            node ${./nix/smoke.mjs} ${
              self.packages.${system}.hui.override {
                gatewayHost = "127.0.0.2";
                gatewayPort = 5187;
              }
            } ${pkgs.bash}/bin/bash configured
            touch "$out"
          '';
          package =
            pkgs.runCommand "hui-package-smoke"
              {
                nativeBuildInputs = [ pkgs.nodejs_24 ];
              }
              ''
                node ${./nix/smoke.mjs} ${self.packages.${system}.hui} ${pkgs.bash}/bin/bash
                touch "$out"
              '';
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24
              git
              ripgrep
              fd
              python3
              pkg-config
            ];
            # npm's prebuilt native modules need libstdc++ on NixOS.
            LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath [ pkgs.stdenv.cc.cc.lib ];
          };
        }
        // nixpkgs.lib.optionalAttrs (system == "x86_64-linux") {
          # The Android app's toolchain (spike S1 of docs/mobile-app-plan.md): the SDK, an x86_64 emulator image and a JDK. The owner
          # accepted the Android SDK licence for this shell (2026-11-09); nothing else in the flake is unfree.
          android =
            let
              androidPkgs = import nixpkgs {
                inherit system;
                config = {
                  allowUnfree = true;
                  android_sdk.accept_license = true;
                };
              };
              sdk = androidPkgs.androidenv.composeAndroidPackages {
                platformVersions = [ "37.0" ];
                buildToolsVersions = [
                  "35.0.0"
                  "36.0.0"
                ];
                includeEmulator = true;
                includeSystemImages = true;
                systemImageTypes = [ "google_apis" ];
                abiVersions = [ "x86_64" ];
                includeNDK = false;
              };
              androidHome = "${sdk.androidsdk}/libexec/android-sdk";
              # agent-device (the e2e engine's device layer, and how an agent drives the emulator) runs /bin/ps,
              # which NixOS lacks; this runs the checkout's copy in an FHS namespace that has it. Its daemon outlives
              # each call (no die-with-parent) and shares the host's PIDs, so later calls find and reuse it.
              agentDevice = androidPkgs.buildFHSEnv {
                name = "agent-device";
                targetPkgs = p: [
                  p.procps
                  p.nodejs_24
                ];
                dieWithParent = false;
                runScript = androidPkgs.writeShellScript "agent-device" ''
                  exec npx --no-install agent-device "$@"
                '';
              };
            in
            androidPkgs.mkShell {
              packages = [
                sdk.androidsdk
                androidPkgs.jdk21
                androidPkgs.nodejs_24
                androidPkgs.git
                # agent-device, which drives the emulator for screenshots and the e2e suite, reads processes with ps.
                androidPkgs.procps
                agentDevice
              ];
              ANDROID_HOME = androidHome;
              ANDROID_SDK_ROOT = androidHome;
              JAVA_HOME = androidPkgs.jdk21.home;
              # AGP downloads a generic-Linux aapt2 that NixOS can't run; use the SDK's own.
              GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidHome}/build-tools/36.0.0/aapt2";
            };
        }
      );
    };
}
