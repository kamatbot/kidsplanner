package com.fametc.app.ui

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.fametc.app.FamEtcApp
import com.fametc.app.ui.features.onboarding.BackupCodeSignInScreen
import com.fametc.app.ui.features.onboarding.KidSignInScreen
import com.fametc.app.ui.features.onboarding.OnboardingScreen
import com.fametc.app.ui.navigation.RootScreen
import com.fametc.app.ui.theme.FamEtcTheme
import com.fametc.app.ui.theme.FamTheme

private enum class OnboardingSubRoute {
    MAIN, KID_SIGN_IN, BACKUP_CODE_SIGN_IN
}

class MainActivity : ComponentActivity() {

    private val prefs by lazy { getSharedPreferences("fametc_prefs", Context.MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            FamEtcTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = FamTheme.colors.bg
                ) {
                    var onboarded by remember {
                        mutableStateOf(prefs.getBoolean("fam_onboarded", false))
                    }
                    var onboardingSubRoute by remember { mutableStateOf(OnboardingSubRoute.MAIN) }

                    if (onboarded) {
                        RootScreen(
                            onSignOut = {
                                FamEtcApp.instance.repository.signedOut()
                                prefs.edit().putBoolean("fam_onboarded", false).apply()
                                onboarded = false
                                onboardingSubRoute = OnboardingSubRoute.MAIN
                            }
                        )
                    } else {
                        when (onboardingSubRoute) {
                            OnboardingSubRoute.MAIN -> {
                                OnboardingScreen(
                                    onFinished = {
                                        prefs.edit().putBoolean("fam_onboarded", true).apply()
                                        onboarded = true
                                    },
                                    onOpenKidSignIn = {
                                        onboardingSubRoute = OnboardingSubRoute.KID_SIGN_IN
                                    },
                                    onOpenBackupCodeSignIn = {
                                        onboardingSubRoute = OnboardingSubRoute.BACKUP_CODE_SIGN_IN
                                    }
                                )
                            }
                            OnboardingSubRoute.KID_SIGN_IN -> {
                                KidSignInScreen(
                                    onDone = {
                                        prefs.edit().putBoolean("fam_onboarded", true).apply()
                                        onboarded = true
                                    },
                                    onBack = {
                                        onboardingSubRoute = OnboardingSubRoute.MAIN
                                    }
                                )
                            }
                            OnboardingSubRoute.BACKUP_CODE_SIGN_IN -> {
                                BackupCodeSignInScreen(
                                    onDone = {
                                        prefs.edit().putBoolean("fam_onboarded", true).apply()
                                        onboarded = true
                                    },
                                    onBack = {
                                        onboardingSubRoute = OnboardingSubRoute.MAIN
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
