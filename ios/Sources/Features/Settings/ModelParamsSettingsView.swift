import SwiftUI

/// Sampling parameters + the global system instruction. Presets just fill in
/// the same sliders — applying one is a starting point, not a locked-in
/// mode, matching the web version (`MP_PRESETS` + full manual sliders, not
/// either/or): untouched, a preset's own numbers apply; touch a slider and
/// that value sticks until you apply a preset again or change it yourself.
struct ModelParamsSettingsView: View {
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        Form {
            Section {
                HStack(spacing: 8) {
                    presetButton("Творческий", preset: .creative)
                    presetButton("Баланс", preset: .balanced)
                    presetButton("Точный", preset: .precise)
                }
                .padding(.vertical, 4)

                sliderRow(title: "Температура", hint: "Ниже — отвечает чётко и по делу. Выше — фантазирует и удивляет.",
                          value: doubleBinding(\.temperature), range: 0...2, step: 0.05, format: { String(format: "%.2f", $0) })
                sliderRow(title: "Длина ответа", hint: "Максимальный размер одного ответа.",
                          value: intBinding(\.maxTokens), range: 64...4096, step: 64, format: { String(Int($0)) })
                sliderRow(title: "Память", hint: "Сколько последних сообщений персонаж помнит.",
                          value: intBinding(\.contextMessages), range: 2...100, step: 2, format: { String(Int($0)) })
                sliderRow(title: "Top P", hint: "Из какой доли вероятных слов выбирать. Обычно не трогают.",
                          value: doubleBinding(\.topP), range: 0.1...1, step: 0.05, format: { String(format: "%.2f", $0) })
                sliderRow(title: "Top K", hint: "Сколько вариантов слов рассматривать. Обычно не трогают.",
                          value: intBinding(\.topK), range: 1...100, step: 1, format: { String(Int($0)) })
            } header: {
                Text("Параметры модели")
            }
            .listRowBackground(WesaidTheme.surface)

            Section {
                TextField("Например: отвечай только на русском языке.", text: Binding(
                    get: { settings.settings.modelParams.globalSystem },
                    set: { settings.settings.modelParams.globalSystem = $0 }
                ), axis: .vertical)
                .lineLimit(2...5)
            } header: {
                Text("Общие инструкции для всех персонажей")
            }
            .listRowBackground(WesaidTheme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Модель")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
    }

    private func presetButton(_ title: String, preset: ModelParams) -> some View {
        Button {
            settings.applyPreset(preset)
        } label: {
            Text(title)
                .font(.subheadline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
        }
        .buttonStyle(.bordered)
        .tint(WesaidTheme.accent)
    }

    private func sliderRow(title: String, hint: String, value: Binding<Double>,
                            range: ClosedRange<Double>, step: Double, format: @escaping (Double) -> String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(title)
                Spacer()
                Text(format(value.wrappedValue))
                    .foregroundStyle(WesaidTheme.text3)
                    .monospacedDigit()
            }
            Slider(value: value, in: range, step: step)
                .tint(WesaidTheme.accent)
            Text(hint)
                .font(.caption2)
                .foregroundStyle(WesaidTheme.text3)
        }
        .padding(.vertical, 2)
    }

    private func doubleBinding(_ keyPath: WritableKeyPath<ModelParams, Double>) -> Binding<Double> {
        Binding(
            get: { settings.settings.modelParams[keyPath: keyPath] },
            set: { settings.settings.modelParams[keyPath: keyPath] = $0 }
        )
    }

    private func intBinding(_ keyPath: WritableKeyPath<ModelParams, Int>) -> Binding<Double> {
        Binding(
            get: { Double(settings.settings.modelParams[keyPath: keyPath]) },
            set: { settings.settings.modelParams[keyPath: keyPath] = Int($0) }
        )
    }
}
