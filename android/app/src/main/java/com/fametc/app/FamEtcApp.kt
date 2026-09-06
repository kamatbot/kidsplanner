package com.fametc.app

import android.app.Application
import com.fametc.app.data.local.DiskCache
import com.fametc.app.data.remote.ApiClient
import com.fametc.app.data.repository.AppRepository

class FamEtcApp : Application() {

    companion object {
        lateinit var instance: FamEtcApp
            private set
    }

    lateinit var diskCache: DiskCache
        private set

    lateinit var repository: AppRepository
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Initialize networking and local disk cache
        ApiClient.initialize(this)
        diskCache = DiskCache(this)
        repository = AppRepository(this, ApiClient.api, diskCache)
    }
}
