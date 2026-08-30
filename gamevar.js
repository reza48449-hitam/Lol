// gamevar.js — Anti-detect + Anticheat Bypass v2.1
// FIX:
//   - fallbackConfig sekarang lazy-build (get property) → jitter aktif
//   - Hapus duplicate registerDummyEndpoints (sudah ada di proxy.js)
//   - Tambah bypass vars baru (ANO, emulator check, HWID bypass)

// ============================================================
//  LAYER 1 — OBFUSCATOR
//  Nilai float/int sensitif di-jitter tipis tiap request
//  biar fingerprint response-nya ga sama persis
// ============================================================
function jf(base, range = 0.001) {
    return (parseFloat(base) + (Math.random() - 0.5) * range).toFixed(6);
}
function ji(base) {
    return String(base + Math.floor(Math.random() * 10));
}

// ============================================================
//  LAYER 2 — GAMEVAR LINES
// ============================================================
function buildGamevarLines(myDomain) {
    const GIN_DUMMY = myDomain + 'api/gin_dummy';
    const WEB_DUMMY = myDomain + 'api/web_dummy';

    return [
        "var_name,comment,var_type,var_value,var_region,var_platform",

        // === MOVEMENT ===
        "RunSpeed,RunSpeed,float,6,,",
        "DashSpeedScale,DashSpeedScale,float,10,,",
        "CrouchSpeed,CrouchSpeed,float,2.5,,",
        "DieingSpeed,DieingSpeed,float,1,,",
        "SwimSpeed,SwimSpeed,float,4.2,,",
        "ResetRotationSpeed,ResetRotationSpeed,float,100,,",
        "CarryingWalkSpeedScale,CarryingWalkSpeedScale,float,100,,",
        "HighFallActionSpeed,HighFallActionSpeed,float,100,,",
        "CatapultSpeed,CatapultSpeed,float,100,,",
        "StropUseCooldown,StropUseCooldown,float,100,,",
        "CrossOverJumpHorizontalSpeed,CrossOverJumpHorizontalSpeed,float,100,,",
        "CanJumpFallingRunFast,CanJumpFallingRunFast,bool,true,,",
        "CanCreepRunFast,CanCreepRunFast,bool,true,,",
        "CanCrouchingRunFast,CanCrouchingRunFast,bool,true,,",
        "StropFallingResetSpeed,StropFallingResetSpeed,bool,false,,",
        "StropFallingDamageMax,StropFallingDamageMax,int32,0,,",

        // === SENSITIVITY ===
        "SensitivityMaxSetting,SensitivityMaxSetting,float,9.5,,",
        "Sensitivity1PMaxSetting,Sensitivity1PMaxSetting,float,9.5,,",
        "X1ScopeMaxSetting,X1ScopeMaxSetting,float,9.5,,",
        "X2ScopeMaxSetting,X2ScopeMaxSetting,float,9.5,,",
        "X4ScopeMaxSetting,X4ScopeMaxSetting,float,9.5,,",
        "X8ScopeMaxSetting,X8ScopeMaxSetting,float,9.5,,",
        "FreeLookMaxSetting,FreeLookMaxSetting,float,9.5,,",

        // === AIM ASSIST ===
        "AimAssistMode,AimAssistMode,int,6,,",
        "AimAssistThreshold,AimAssistThreshold,float,15.0,,",
        "AimAssistSpeed,AimAssistSpeed,float,15.0,,",
        "AimAssistRange,AimAssistRange,float,15.0,,",
        "AimAssistSmoothness,AimAssistSmoothness,float,15.0,,",
        "FreeMoveAngularSpeed,FreeMoveAngularSpeed,float,100000,,",
        "FreeMoveAngularSpeedStand,FreeMoveAngularSpeedStand,float,100000,,",
        "FreeMoveAngularSpeedCrouch,FreeMoveAngularSpeedCrouch,float,100000,,",
        "FreeMoveAngularSpeedCreep,FreeMoveAngularSpeedCreep,float,100000,,",
        "FreeMoveAngularSpeedKnockDown,FreeMoveAngularSpeedKnockDown,float,100000,,",
        "AutoEnemyMarkSwitch,AutoEnemyMarkSwitch,int,2,,",
        "AutoEnemyMarkDuration,AutoEnemyMarkDuration,bool,999999999999999999,,",

        // === HITBOX & HEADSHOT ===
        "HitBoxScale,HitBoxScale,float,999.99,,",
        "HeadShotMode,HeadShotMode,bool,true,,",
        "ForceHeadShot,ForceHeadShot,bool,true,,",
        "headShotBonusDamage,headShotBonusDamage,float,15.5,,",
        "UseSniperCollider,UseSniperCollider,bool,True,,",
        "SniperStandingColliderRadius,SniperStandingColliderRadius,float,1.5,,",
        "SniperCrouchingColliderRadius,SniperCrouchingColliderRadius,float,1,,",
        "SniperCreepingColliderRadius,SniperCreepingColliderRadius,float,1,,",

        // === JUMP & GRAVITY ===
        "JumpHeight,JumpHeight,float,10.5,,",
        "JumpSpeed,JumpSpeed,float,10.5,,",
        "GravityScale,GravityScale,float,0.9,,",
        "MaxJumpCount,MaxJumpCount,int,3,,",

        // === WEAPON & SWAP ===
        "SwapSpeed,SwapSpeed,float,0.1,,",
        "SwapWeaponCD,SwapWeaponCD,float,0.2,,",
        "FastSwap,FastSwap,bool,true,,",
        "CanReloadContinueShoot,CanReloadContinueShoot,bool,True,,",
        "LessIsMoreMinReloadInterval,LessIsMoreMinReloadInterval,uint32,1,,",
        "LessIsMorePendingReloadInterval,LessIsMorePendingReloadInterval,uint32,1,,",
        "NoResetUplayerAnimationWhenReloading,NoResetUplayerAnimationWhenReloading,bool,True,,",

        // === REVIVE & HEAL ===
        "ReviveTimeout,ReviveTimeout,int,1,,",
        "FastReviveAfterBooyah,FastReviveAfterBooyah,float,0,,",
        "PengdingReviveCamraTime,PengdingReviveCamraTime,int,1,,",
        "UseMedkitTime,UseMedkitTime,float,0,,",
        "UseArmortoolsTime,UseArmortoolsTime,float,0,,",
        "ReviveCardTimeLimitRedNoticeDuration,ReviveCardTimeLimitRedNoticeDuration,float,0,,",
        "ReviveCardTimeLimitedShowDuration,ReviveCardTimeLimitedShowDuration,float,0,,",
        "ReviveCardTimeBannedPopDuration,ReviveCardTimeBannedPopDuration,float,0,,",
        "ReviveCardTimeTimeoutPopDuration,ReviveCardTimeTimeoutPopDuration,float,0,,",
        "CallForReviveCDTime,CallForReviveCDTime,float,0,,",
        "EnablePendingRevivePlayersThermalView,EnablePendingRevivePlayersThermalView,bool,true,,",
        "IsUseMedkitForceStand,IsUseMedkitForceStand,bool,False,,",

        // === VEHICLE ===
        "VehicleKillPersonMinSpeedSqr,VehicleKillPersonMinSpeedSqr,float,0.1,,",
        "CarCrashDamageScaleToPlayer,CarCrashDamageScaleToPlayer,float,10000,,",
        "CarCrashDamageScaleWhenHitWall,CarCrashDamageScaleWhenHitWall,float,0,,",
        "InCarColliderHeight,InCarColliderHeight,float,2,,",

        // === VISUAL & GRAPHICS ===
        "ShowHighFrameRateSetting,ShowHighFrameRateSetting,bool,true,,",
        "Real60FrameSwitch,Real60FrameSwitch,bool,true,,",
        "HighFPSSetting,HighFPSSetting,bool,true,,",
        "MAXQualityAB,MAXQualityAB,bool,True,,",
        "EnableOptimizeByQuality,EnableOptimizeByQuality,bool,False,,",
        "EnableQualityRenderer,EnableQualityRenderer,bool,True,,",
        "ForceShowHighQuality,ForceShowHighQuality,bool,True,,",
        "ForceShowHighInQualityHigh,ForceShowHighInQualityHigh,bool,True,,",
        "CharacterRecvShadow,CharacterRecvShadow,bool,True,,",
        "HDShowShadowOption,HDShowShadowOption,bool,True,,",
        "LobbyCloserShadow,LobbyCloserShadow,bool,True,,",
        "LobbyCloserShadowHD,LobbyCloserShadowHD,bool,True,,",
        "EnableBloom,EnableBloom,bool,True,,",
        "EnableShibuyaFogAndBloom,EnableShibuyaFogAndBloom,bool,True,,",
        "IsAlbumScreenShotNeedAntiMod,IsAlbumScreenShotNeedAntiMod,bool,false,,",

        // === OUTLINE / ESP ===
        "EnableShowPlayerOutline,EnableShowPlayerOutline,bool,True,,",
        "ShowPlayerOutlineMaxDistance,ShowPlayerOutlineMaxDistance,uint32,500,,",
        "EnableOutlineFuncInScript,EnableOutlineFuncInScript,bool,True,,",
        "OutlineVisibleJudgeInUpDate,OutlineVisibleJudgeInUpDate,bool,True,,",
        "PlayerOutlineWidthSpecial,PlayerOutlineWidthSpecial,float,500,,",
        "EnableShowTargetOnMap,EnableShowTargetOnMap,bool,True,,",
        "EnableShowTargetprint,EnableShowTargetprint,bool,True,,",
        "ShowEnemyMark,ShowEnemyMark,bool,True,,",
        "ShowEnemyMarkMoco,ShowEnemyMarkMoco,bool,True,,",

        // === ANIMATION ===
        "KeepFallingLandAnim,KeepFallingLandAnim,bool,True,,",
        "CallStopEmoteAtPlayFireAnim,CallStopEmoteAtPlayFireAnim,bool,True,,",
        "BanFastRunWhenFire,BanFastRunWhenFire,bool,True,,",
        "FixCrouchFireAnim,FixCrouchFireAnim,bool,True,,",
        "StartDashWhenFallingApplySpeedDown,StartDashWhenFallingApplySpeedDown,bool,False,,",
        "EnableFallingDashOptimize,EnableFallingDashOptimize,bool,True,,",
        "EnableFFOPortingHDAnimation,EnableFFOPortingHDAnimation,bool,False,,",

        // === CUSTOM / ROOM ===
        "IngameCustomOpen,IngameCustomOpen,bool,True,,",
        "IceWallModuleDefaultID,IceWallModuleDefaultID,int32,907104212,,",
        "EnableCustomRoom,EnableCustomRoom,bool,True,,",
        "EnableCustomRoomAuthority,EnableCustomRoomAuthority,bool,True,,",
        "EnableCustom,EnableCustom,bool,True,,",
        "NickNameMaxLength,NickNameMaxLength,int32,30,,",
        "NicknameLengthMin,NicknameLengthMin,int32,1,,",
        "AlwaysCanShowEmotePanel,AlwaysCanShowEmotePanel,bool,True,,",
        "ObserverCanThumbUp,ObserverCanThumbUp,bool,True,,",
        "PCBooyahV2,PCBooyahV2,bool,True,,",
        "IsOpenCSTeamGoal,IsOpenCSTeamGoal,bool,True,,",

        // ============================================================
        //  LAYER 3 — ANTICHEAT BYPASS
        // ============================================================

        // --- Hack detection: disable ---
        "EnableIceWallHacker,EnableIceWallHacker,bool,True,,",
        "EnableIceWallHackerKill,EnableIceWallHackerKill,bool,True,,",
        "EnableHipHackerKill,EnableHipHackerKill,bool,True,,",
        "EnableSendHackStoreLog,EnableSendHackStoreLog,bool,False,,",
        "CameraHackRuntimeCheckIsWaitingCabinPhase,CameraHackRuntimeCheckIsWaitingCabinPhase,bool,False,,",
        "DisableErrorLog,DisableErrorLog,bool,True,,",
        "EnableCheckSandModeBySwitchFunc,EnableCheckSandModeBySwitchFunc,bool,False,,",
        "CleanFFAntiState,CleanFFAntiState,bool,True,,",

        // --- Upload / location ---
        "SaveLocationInPlatform,SaveLocationInPlatform,bool,False,,",

        // --- GGP disable ---
        "EnableGGPDecryptFailureProtection,EnableGGPDecryptFailureProtection,bool,False,,",
        "EarlyInitGGP,EarlyInitGGP,bool,false,,",
        "GGPLoginOnce,GGPLoginOnce,bool,false,,",
        "EnableGGPOnLowMemory,EnableGGPOnLowMemory,bool,false,,",

        // --- File integrity: off ---
        "EnableFileInfoEncryptionAndroid,EnableFileInfoEncryptionAndroid,bool,False,,",
        "EnableFileInfoEncryptionIOS,EnableFileInfoEncryptionIOS,bool,False,,",
        "OptionalDeepFileCheck,OptionalDeepFileCheck,bool,False,,",
        "EnableOBBCheck,EnableOBBCheck,bool,False,,",
        "EnableCheckFileStates,EnableCheckFileStates,bool,False,,",
        "OptionalDownloadHashCheckOpen,OptionalDownloadHashCheckOpen,bool,False,,",
        "should_check_ab_load,should_check_ab_load,bool,False,,",

        // --- Avatar/item validation ---
        "ModifyAvatarCode,ModifyAvatarCode,bool,False,,",
        "ModifyAvatarDataCode,ModifyAvatarDataCode,bool,False,,",

        // --- Signature & native check ---
        "NeedSignatureInfo,NeedSignatureInfo,bool,False,,",
        "EnableNativeCheck,EnableNativeCheck,bool,False,,",
        "EnablePlatformCheck,EnablePlatformCheck,bool,False,,",
        "EnableMMKPlatformCheck,EnableMMKPlatformCheck,bool,False,,",
        "EnableSupCheck,EnableSupCheck,bool,False,,",

        // --- Firebase / crashlytics ---
        "EnableFirebase_Crashlytics,EnableFirebase_Crashlytics,bool,False,,",

        // --- Antihack region ---
        "FFAntihackDisabledRegions,FFAntihackDisabledRegions,string,ID,,",
        "FFAntihackDisabledClientVariant,FFAntihackDisabledClientVariant,string,ClientUsingVersion_NONE,,",
        "EnableMtpLiteDataRegion,EnableMtpLiteDataRegion,string,,,",
        "FFAntihackEmulatorCheckDisbaledClientVariant,FFAntihackEmulatorCheckDisbaledClientVariant,string,ClientUsingVersion_NONE,,",
        "ANODisabledRegions,ANODisabledRegions,string,ID,,",
        "ANODisabledClientVariant,ANODisabledClientVariant,string,ID,,",
        "ANOEmulatorCheckDisbaledClientVariant,ANOEmulatorCheckDisbaledClientVariant,string,,,",

        // --- Defence level ---
        "FFAntihackDefenceLevel,FFAntihackDefenceLevel,string,999999,,",
        "FFAntihackLightInitOnThread,FFAntihackLightInitOnThread,bool,false,,",
        "FFAntihackSDKDetailEncryptBySHA1,FFAntihackSDKDetailEncryptBySHA1,bool,false,,",

        // --- Hack flags ---
        "CheckHacker,CheckHacker,bool,false,,",
        "DebugHack,DebugHack,bool,true,,",
        "TestModeEnabled,TestModeEnabled,bool,true,,",

        // NEW: Emulator & HWID bypass (tambahan v2.1)
        "EnableEmulatorCheck,EnableEmulatorCheck,bool,False,,",
        "EmulatorCheckInterval,EmulatorCheckInterval,int,999999,,",
        "EnableHWIDCheck,EnableHWIDCheck,bool,False,,",
        "HWIDCheckCDTime,HWIDCheckCDTime,float,999999999,,",
        "EnableDeviceBindCheck,EnableDeviceBindCheck,bool,False,,",
        "DeviceBindCheckInterval,DeviceBindCheckInterval,int,999999,,",

        // NEW: Root/Magisk detection bypass (tambahan v2.1)
        "EnableRootCheck,EnableRootCheck,bool,False,,",
        "EnableMagiskCheck,EnableMagiskCheck,bool,False,,",
        "RootCheckInterval,RootCheckInterval,int,999999,,",

        // ============================================================
        //  LAYER 4 — GIN LOG INTERCEPT
        // ============================================================
        "DisableGinInfoSend,DisableGinInfoSend,int,1,,",
        "GinInfoBRAliveThreshold,GinInfoBRAliveThreshold,int,999999,,",
        "AntiHackResetSubgameInterval,AntiHackResetSubgameInterval,int,999999,,",
        "FFANTIHACKEXT_SPLIT_THRESHOLD,FFANTIHACKEXT_SPLIT_THRESHOLD,int,999999,,",
        "NeedProcessAH,NeedProcessAH,bool,false,,",

        // --- Report count: 999999 ---
        "Reportee_Damager_RecentlyMaxCnt,Reportee_Damager_RecentlyMaxCnt,int,999999,,",
        "Reportee_Killer_RecentlyMaxCnt,Reportee_Killer_RecentlyMaxCnt,int,999999,,",
        "GGPUpdateFlag,GGPUpdateFlag,int,999999,,",
        "ChatReportMaxTimes,ChatReportMaxTimes,uint32,999999,,",
        "ClanReportMaxTimes,ClanReportMaxTimes,uint32,999999,,",
        "BlocklistMaxNum,BlocklistMaxNum,Int32,999999,,",

        // --- Memory check ---
        "MemoryCheckString,MemoryCheckString,string,,,",

        // --- Age/ban check ---
        "AgeCtrlAndroidBanCheckByInstallID,AgeCtrlAndroidBanCheckByInstallID,bool,False,,",
        "ReturnToLobbyCheckAlbumOverTimeFile,ReturnToLobbyCheckAlbumOverTimeFile,bool,False,,",
        "EnableCheckOverlapWithSantioDummy,EnableCheckOverlapWithSantioDummy,bool,False,,",
        "EnableIngameQuickReport,EnableIngameQuickReport,bool,False,,",
        "AgeCtrl_iOSPrecheckForMinor,AgeCtrl_iOSPrecheckForMinor,bool,False,,",
        "AgeCtrl_CheckForThirdPartyBuild,AgeCtrl_CheckForThirdPartyBuild,bool,False,,",
        "AgeCtrl_PromptWhenBannedByStrategy_iOS,AgeCtrl_PromptWhenBannedByStrategy_iOS,bool,False,,",
        "AgeCtrl_PromptWhenBannedByStrategy_Android,AgeCtrl_PromptWhenBannedByStrategy_Android,bool,False,,",
        "EnableFFAntihackInfoExtra,EnableFFAntihackInfoExtra,bool,False,,",
        "EnableTrustItemCountFromServer,EnableTrustItemCountFromServer,bool,False,,",
        "BanStateDisabledArea,BanStateDisabledArea,string,ID;US;BR;SG,,",
        "EnableCheckMatchEndDelayWhenDisconnect,EnableCheckMatchEndDelayWhenDisconnect,bool,False,,",

        // === LOGIN & QUEUE BYPASS ===
        "EnableLoginQueue,EnableLoginQueue,bool,False,,",
        "MinIntervalForRequestQueueInfo,MinIntervalForRequestQueueInfo,uint,999999999999999,,",
        "MaxIntervalForRequestQueueInfo,MaxIntervalForRequestQueueInfo,uint,999999999999999,,",
        "CSBanPickClientDelay,CSBanPickClientDelay,float,100000000000,,",
        "CoinCountChangeTime,CoinCountChangeTime,float,100000000000,,",
        "CSShopNeedCoinCheckNum,CSShopNeedCoinCheckNum,int,0,,",
        "CSBPRequestBanTime,CSBPRequestBanTime,float,10000000000000000000,,",
        "NetworkDetectionCDTime,NetworkDetectionCDTime,float,999999999999999999,,",
        "EnableBugReportTime,EnableBugReportTime,bool,false,,",

        // === MISC ===
        "SkySurfingRotationSpeed,SkySurfingRotationSpeed,float,10000,,",
        "SkyDashingRotationSpeed,SkyDashingRotationSpeed,float,10000,,",
        "SkyDivingRotationSpeed,SkyDivingRotationSpeed,float,10000,,",
        "CanSwimSurfing,CanSwimSurfing,bool,True,,",
        "EnableSnowFlake,EnableSnowFlake,bool,True,,",
        "EnableVibrateFeature,EnableVibrateFeature,bool,True,,",
        "EnableCollectionEffect,EnableCollectionEffect,bool,True,,",
        "EnableQualityNewIsEffect,EnableQualityNewIsEffect,bool,True,,",
        "EnableShaderRuntimeReload,EnableShaderRuntimeReload,bool,True,,",
        "EnableClanNameAndLogoCapture,EnableClanNameAndLogoCapture,bool,True,,",
        "UseLiveScreen,UseLiveScreen,bool,True,,",
        "EnableFireFastWeaponStateFixed,EnableFireFastWeaponStateFixed,bool,True,,",
        "EnableNewLocFix,EnableNewLocFix,bool,False,,",
        "PlayerOnSlopeCheckByRaycast,PlayerOnSlopeCheckByRaycast,bool,False,,",
        "FixFireOpenWhenSniperCloseNextFireAction,FixFireOpenWhenSniperCloseNextFireAction,bool,False,,",
        "OpenNewPlayerHud,OpenNewPlayerHud,bool,False,,",
        "OpenNewDownloadHandlerWay,OpenNewDownloadHandlerWay,bool,False,,",
        "ReleaseMemForMatchEndFor3I3A,ReleaseMemForMatchEndFor3I3A,bool,False,,",
        "EnableVariableFFVoiceIDC,EnableVariableFFVoiceIDC,bool,false,,",
        "EnableYieldMutexDuringAsyncLoad,EnableYieldMutexDuringAsyncLoad,bool,false,,",
        "NinthProgressLoadingDuration,NinthProgressLoadingDuration,float,0,,",
        "EnableUGCScrollViewCulling,EnableUGCScrollViewCulling,bool,false,,",
        "EnableUGCHalfwayJoin,EnableUGCHalfwayJoin,bool,false,,",
        "ReservedInt01,ReservedInt01,int,5,,",
        "NinthLevelPortalRadius,NinthLevelPortalRadius,float,20,,",
        "Enable2018ABstreamed,Enable2018ABstreamed,bool,false,,ios",
        "EnableAsyncCullResultsRelease,EnableAsyncCullResultsRelease,bool,false,,ios",
        "ReservedInt02,ReservedInt02,int,30,,",
        "LadderMatchSplashRegionOn,LadderMatchSplashRegionOn,string,PK;EUROPE;TH;SG;TW;BR,,",
    ];
}

// ============================================================
//  LAYER 5 — DUMMY GIN ENDPOINT
//  NOTE: Hanya register di sini sebagai fallback.
//  proxy.js registerTelemetryAbsorbers() sudah handle semua
//  dengan priority tinggi — jangan double-register path yang sama.
// ============================================================
function registerDummyEndpoints(app) {
    const absorb = (req, res) => {
        res.status(200).json({ code: 0, message: 'ok', ts: Date.now() });
    };

    // Hanya endpoint yang TIDAK ada di proxy.js (path spesifik gamevar)
    app.all('/api/gin_dummy',   absorb);
    app.all('/api/web_dummy',   absorb);

    console.log('[GAMEVAR] GIN/GGP dummy endpoints registered');
}

// ============================================================
//  ALLOWED IPs & CONFIG
// ============================================================
const ALLOWED_IPS         = ["117.18.20.142"];
const isGlobalMaintenance = false;
const MY_IP               = "https://proxy-reza-kontolodon-memek.up.railway.app/";

// ============================================================
//  getVerConfig — dipakai modules/gamevar.js
//  gamevar di-build fresh tiap request biar nilai obfuscated beda
// ============================================================
function getVerConfig(clientIp = "74.125.24.139", myDomain = MY_IP) {
    const isAllowedUser    = ALLOWED_IPS.includes(clientIp);
    const serverOpenStatus = isGlobalMaintenance ? isAllowedUser : true;
    const CDN_BASE         = myDomain + "cdn/";

    const lines = buildGamevarLines(myDomain);

    return {
        "abhotupdate_cdn_url":                  CDN_BASE,
        "abhotupdate_check":                    "cache_res;assetindexer;SH-Gpp",
        "anti_hack_open":                       false,
        "apply_skin":                           0,
        "appstore_url":                         "https://whatsapp.com/channel/0029Vb8eX0Z1NCrYCXEXuu0K",
        "backup_appstore_url":                  "",
        "backup_cdn_url":                       CDN_BASE,
        "billboard_bg_url":                     "https://files.catbox.moe/y4z6hm.jpg",
        "billboard_cdn_url":                    "https://whatsapp.com/channel/0029Vb8eX0Z1NCrYCXEXuu0K",
        "billboard_msg":                        serverOpenStatus ? "" : "[FFF000][B]TUNGGU LAGI MAU DI UPDATE BRO",
        "cdn_active":                           myDomain,
        "cdn_ip_list":                          [],
        "cdn_port":                             6072,
        "cdn_url":                              CDN_BASE,
        "client_ip":                            clientIp,
        "code":                                 0,
        "core_ip_list":                         ["0.0.0.0", "50.109.27.134", "129.226.2.163", "129.226.1.13", "129.226.1.16"],
        "core_url":                             "gin.freefiremobile.com",
        "country_code":                         "BR",
        "device_whitelist_priority":            0,
        "device_whitelist_sp_priority":         0,
        "device_whitelist_sp_version":          "",
        "device_whitelist_version":             "",
        "enable_clear_mem_when_autopause":      true,
        "enable_hash_pdcache":                  true,
        "enable_min_height":                    false,
        "enable_min_resolution_height":         false,
        "enable_reduce_rate":                   false,
        "enable_unmap_web_view_vm":             false,
        "force_refresh_restype":                "optionalavatarres",
        "force_to_restart_app":                 false,
        "free_guest_login":                     true,
        "free_rematch":                         true,
        "gamevar":                              lines.join("\n"),
        "garena_hint":                          true,
        "garena_login":                         true,
        "gdpr_version":                         0,
        "ggp_url":                              "gin.freefiremobile.com",
        "gop_url":                              "",
        "graphic_level":                        5,
        "grey_update_percent":                  0,
        "guest_login":                          true,
        "high_frame_default":                   0,
        "hotfile_force_update":                 true,
        "hs_config":                            { "nome": "", "porta": 6072 },
        "img_cdn_url":                          CDN_BASE,
        "is_firewall_open":                     false,
        "is_review_server":                     false,
        "is_server_open":                       serverOpenStatus,
        "is_update_btn_show":                   true,
        "is_use_multi_download":                true,
        "latest_release_version":               "OB54",
        "LoadLocalImage":                       "https://files.catbox.moe/y4z6hm.jpg",
        "login_download_optionalpack":          "optionalclothres:shaders|optionalpetres:optionalpetres_commonab_shader|optionallobbyres:",
        "login_failed_count":                   2,
        "login_notice":                         serverOpenStatus ? "Welcome to Proxy Server!" : "Server Sedang Dalam Perbaikan.",
        "maintain_msg":                         serverOpenStatus ? "" : "Server Sedang Maintenance.",
        "maintain_url":                         "https://whatsapp.com/channel/0029Vb8eX0Z1NCrYCXEXuu0K",
        "maintenance_announcement":             null,
        "maintenance_region":                   null,
        "max_store":                            "",
        "max_video":                            "",
        "max_web":                              "",
        "min_hint_size":                        1,
        "multi_region":                         "BR",
        "need_check_ip_list":                   ["202.81.108.9"],
        "need_track_hotupdate":                 true,
        "network_log_server":                   myDomain + "api/gin_dummy",
        "web_log_server":                       myDomain + "api/web_dummy",
        "notice_url":                           myDomain,
        "patchnote_url":                        "https://whatsapp.com/channel/0029VbBnIVuCMY0POm5gqO1P",
        "quality_level":                        5,
        "remote_option_version":                "optionallocres:50|optionalavatarres:791|optionalclothres:1228|optionalfootballres:27|optionalfullscreencgres:319|optionalhuntinggroundres:246|optionalinfection:125|optionalingameres:503|optionallobbyres:640|optionallonewolfres:86|optionallonewolfstrikeoutres:59|optionalludores:42|optionalmap1res:385|optionalmap2res:156|optionalmap4res:139|optionalmaphippores:118|optionalmapres:357|optionalnewblast:163|optionalpetres:910|optionalrushb:108|optionalrushingpetsres:84|optionalsnowduelres:65|optionalsocialres:223|optionaltrainingres:297|optionalugcres:844|optionalvoiceres:344|optionalwerewolves:153|optionalwerunres:92|optionalmapponyres:204|optionalugcoldparadiseres:34|optionalmultiregionres:29",
        "remote_option_version_astc":           "optionallocres:50|optionalavatarres:753|optionalclothres:1228|optionalfootballres:29|optionalfullscreencgres:306|optionalhuntinggroundres:216|optionalinfection:124|optionalingameres:461|optionallobbyres:640|optionallonewolfres:206|optionallonewolfstrikeoutres:155|optionalludores:175|optionalmap1res:385|optionalmap2res:192|optionalmap4res:175|optionalmaphippores:120|optionalmapres:391|optionalnewblast:162|optionalpetres:910|optionalrushb:241|optionalrushingpetsres:217|optionalsnowduelres:65|optionalsocialres:215|optionaltrainingres:267|optionalugcres:786|optionalvoiceres:379|optionalwerewolves:286|optionalwerunres:81|optionalmapponyres:204|optionalugcoldparadiseres:33|optionalmultiregionres:27",
        "remote_version":                       "1.130.22",
        "resolution_reduceRate_blit_type":      null,
        "res_url":                              CDN_BASE,
        "server_url":                           "https://loginbp.ggblueshark.com/",
        "should_check_ab_exist":                true,
        "should_check_ab_load":                 false,
        "should_check_ab_size":                 true,
        "show_high_framerate_UI":               true,
        "space_required_in_GB":                 1.48,
        "test_url":                             myDomain,
        "use_background_download":              false,
        "use_background_download_lobby":        false,
        "use_backgound_download_mem_thredshold": 2.79999995231628,
        "use_login_optional_download":          true,
        "use_multithread_hash":                 true,
        "use_regional_gamevar":                 true,
        "web_url":                              "",
        "whitelist_info":                       "",
        "whitelist_mask":                       0,
        "whitelist_sp_info":                    "",
        "whitelist_sp_mask":                    0,
    };
}

// ============================================================
//  FALLBACK CONFIG
//  FIX: gamevar di-lazy build via getter → jitter aktif per-akses
// ============================================================
const fallbackConfig = {
    "code":                                    2,
    "use_login_optional_download":             false,
    "use_background_download":                 false,
    "use_background_download_lobby":           false,
    "use_backgound_download_mem_thredshold":   2.79999995231628,
    "country_code":                            "ID",
    "client_ip":                               "162.159.127.136",
    "gdpr_version":                            0,
    "billboard_cdn_url":                       "",
    "billboard_msg":                           "",
    "web_url":                                 "",
    "billboard_bg_url":                        "",
    "max_store":                               "",
    "max_web":                                 "",
    "max_video":                               "",
    "patchnote_url":                           "",
    "multi_region":                            "BD;IN;PK;VN;US;BR;EUROPE",
    "appstore_url":                            "http://www.freefiremobile.com/",
    "backup_appstore_url":                     "",
    "garena_login":                            true,
    "garena_hint":                             true,
    "gop_url":                                 "",
    // FIX: get property → lazy build tiap akses → jitter aktif
    get gamevar() { return buildGamevarLines(MY_IP).join("\n"); },
    "device_whitelist_version":                "1.6.0",
    "whitelist_mask":                          0,
    "whitelist_info":                          "",
    "device_whitelist_sp_version":             "1.0.0",
    "whitelist_sp_mask":                       0,
    "whitelist_sp_info":                       "",
    "ggp_url":                                 MY_IP,
    "abhotupdate_cdn_url":                     MY_IP + "hotpatchs/",
    "img_cdn_url":                             MY_IP,
    "network_log_server":                      MY_IP + "api/gin_dummy",
    "web_log_server":                          MY_IP + "api/web_dummy",
    "core_url":                                new URL(MY_IP).host,
    "core_ip_list":                            ["0.0.0.0", "50.109.254.254"],
    "is_server_open":                          true,
    "is_review_server":                        true,
    "force_to_restart_app":                    false,
    "quality_level":                           5,
    "graphic_level":                           5,
    "maintenance_announcement":                null,
    "maintenance_region":                      null,
    "enable_clear_mem_when_autopause":         true,
    "login_download_optionalpack":             "",
    "need_track_hotupdate":                    false,
    "show_high_framerate_UI":                  true,
    "anti_hack_open":                          false,
};

module.exports = {
    getVerConfig,
    fallbackConfig,
    buildGamevarLines,
    registerDummyEndpoints,
    ALLOWED_IPS,
    isGlobalMaintenance,
    // backward compat
    get gamevarLines() { return buildGamevarLines(MY_IP); },
};
