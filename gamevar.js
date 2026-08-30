function jf(base, range = 0.001) {
    return (parseFloat(base) + (Math.random() - 0.5) * range).toFixed(6);
}
function ji(base) {
    return String(base + Math.floor(Math.random() * 10));
}

function buildGamevarLines(myDomain) {
    const GIN_DUMMY = myDomain + 'api/gin_dummy';
    const WEB_DUMMY = myDomain + 'api/web_dummy';

    return [
        "var_name,comment,var_type,var_value,var_region,var_platform",

        // ============ SPEED ============
        "RunSpeed,RunSpeed,float,6.7,,",
        "DashSpeedScale,DashSpeedScale,float,8.9,,",
        "MaxRunSpeed,MaxRunSpeed,float,8.9,,",
        "CanJumpFallingRunFast,CanJumpFallingRunFast,bool,true,,",
        "CanCreepRunFast,CanCreepRunFast,bool,true,,",
        "CanCrouchingRunFast,CanCrouchingRunFast,bool,true,,",
        "StropFallingResetSpeed,StropFallingResetSpeed,bool,false,,",
        "StropFallingDamageMax,StropFallingDamageMax,int32,0,,",
        "CrossOverJumpHorizontalSpeed,CrossOverJumpHorizontalSpeed,float,100,,",

        // ============ JUMP ============
        "JumpHeight,JumpHeight,float,10.5,,",
        "JumpSpeed,JumpSpeed,float,11.5,,",
        "GravityScale,GravityScale,float,0.5,,",
        "MaxJumpCount,MaxJumpCount,int,3,,",

        // ============ WEAPON SPEED ============
        "FastSwap,FastSwap,bool,true,,",
        "SwapSpeed,SwapSpeed,float,0.1,,",
        // ============ SENSITIVITY ============
        "SensitivityMaxSetting,SensitivityMaxSetting,float,9.9,,",
        "Sensitivity1PMaxSetting,Sensitivity1PMaxSetting,float,9.9,,",
        "X1ScopeMaxSetting,X1ScopeMaxSetting,float,9.9,,",
        "X2ScopeMaxSetting,X2ScopeMaxSetting,float,9.9,,",
        "X4ScopeMaxSetting,X4ScopeMaxSetting,float,9.9,,",
        "X8ScopeMaxSetting,X8ScopeMaxSetting,float,9.9,,",
        "FreeLookMaxSetting,FreeLookMaxSetting,float,9.9,,",

        // ============ OUTLINE ENEMY ============
        "ShowEnemyOutline,ShowEnemyOutline,bool,true,,",
        "EnableEnemyOutline,EnableEnemyOutline,bool,true,,",
        "EnemyOutlineColorR,EnemyOutlineColorR,float,1.0,,",
        "EnemyOutlineColorG,EnemyOutlineColorG,float,0.0,,",
        "EnemyOutlineColorB,EnemyOutlineColorB,float,0.0,,",
        "EnemyOutlineWidth,EnemyOutlineWidth,float,3.0,,",
        "EnableOutlineEnemy,EnableOutlineEnemy,bool,true,,",
        "OutlineEnemyEnable,OutlineEnemyEnable,bool,true,,",
    ];
}

function registerDummyEndpoints(app) {
    const absorb = (req, res) => {
        res.status(200).json({ code: 0, message: 'ok', ts: Date.now() });
    };
    app.all('/api/gin_dummy', absorb);
    app.all('/api/web_dummy', absorb);
    console.log('[GAMEVAR] GIN/GGP dummy endpoints registered');
}

const ALLOWED_IPS         = ["117.18.20.142"];
const isGlobalMaintenance = false;
const MY_IP               = "https://proxy-reza-kontolodon-memek.up.railway.app/";

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
    get gamevarLines() { return buildGamevarLines(MY_IP); },
};
