import SwiftUI

/// A list of categories (each pushing its own screen), matching the pattern
/// Apple's own Settings app uses — the single long `Form` this used to be
/// had grown to nine sections stacked vertically with no way to jump between
/// them.
struct SettingsView: View {
    @EnvironmentObject private var settings: SettingsStore

    var body: some View {
        Form {
            Section {
                categoryRow(title: "Провайдеры", subtitle: activeProviderSubtitle, systemImage: "server.rack") {
                    ProvidersSettingsView()
                }
                categoryRow(title: "Модель", subtitle: "Температура, длина ответа, общие инструкции", systemImage: "slider.horizontal.3") {
                    ModelParamsSettingsView()
                }
                categoryRow(title: "Функции", subtitle: "Память, размышление, перевод импорта", systemImage: "wand.and.stars") {
                    FunctionsSettingsView()
                }
                categoryRow(title: "Кто ты", subtitle: "Персона, от чьего лица ты говоришь с персонажами", systemImage: "person.crop.circle") {
                    PersonaSettingsView()
                }
                categoryRow(title: "Безопасность", subtitle: "Face ID при входе", systemImage: "faceid") {
                    SecuritySettingsView()
                }
                categoryRow(title: "Резервная копия", subtitle: "Экспорт и восстановление", systemImage: "square.and.arrow.up.on.square") {
                    BackupSettingsView()
                }
            }
            .listRowBackground(WesaidTheme.surface)
        }
        .scrollContentBackground(.hidden)
        .background(WesaidTheme.background)
        .navigationTitle("Настройки")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(WesaidTheme.background, for: .navigationBar)
    }

    private var activeProviderSubtitle: String {
        guard let provider = settings.settings.activeProvider, !provider.name.isEmpty else {
            return "Провайдер не настроен"
        }
        return provider.name
    }

    private func categoryRow(title: String, subtitle: String, systemImage: String,
                              @ViewBuilder destination: () -> some View) -> some View {
        NavigationLink {
            destination()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(WesaidTheme.accent)
                    .frame(width: 28, height: 28)
                    .background(WesaidTheme.accent.opacity(0.15), in: RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(WesaidTheme.text1)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(WesaidTheme.text3)
                        .lineLimit(1)
                }
            }
            .padding(.vertical, 2)
        }
    }
}
