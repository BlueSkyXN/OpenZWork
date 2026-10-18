    const composerToolbarSource = readSource("packages/ui/src/v4/composer/V4ComposerToolbar.tsx");

    expect(composerToolbarSource).toContain('setPendingSettingsSectionIntent("modelProvider")');
    expect(composerToolbarSource).toContain("handleOpenModelProviderSettings");
    expect(composerToolbarSource).toContain("onManageModels={handleOpenModelProviderSettings}");
    expect(composerToolbarSource).not.toContain("onManageModels={openSettingsTab}");
