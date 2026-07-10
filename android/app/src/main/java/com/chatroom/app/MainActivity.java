package com.chatroom.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private SwipeRefreshLayout swipeRefresh;
    private String serverUrl;

    private static final String PREFS_NAME = "ChatRoomPrefs";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL = "https://chat-room-1pjo.onrender.com";

    @SuppressLint({"SetJavaScriptEnabled", "ClickableViewAccessibility"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        webView = findViewById(R.id.webView);
        swipeRefresh = findViewById(R.id.swipeRefresh);

        // 读取保存的服务器地址
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        serverUrl = prefs.getString(KEY_URL, DEFAULT_URL);

        setupWebView();
        setupSwipeRefresh();

        webView.loadUrl(serverUrl);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                super.onPageStarted(view, url, favicon);
                if (!swipeRefresh.isRefreshing()) {
                    swipeRefresh.setRefreshing(true);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                swipeRefresh.setRefreshing(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                super.onReceivedError(view, request, error);
                swipeRefresh.setRefreshing(false);
                if (request.isForMainFrame()) {
                    new AlertDialog.Builder(MainActivity.this)
                            .setTitle("连接失败")
                            .setMessage("无法连接到服务器，请检查服务器地址是否正确。\n\n当前地址：" + serverUrl)
                            .setPositiveButton("重新设置", (dialog, which) -> showUrlDialog(false))
                            .setNegativeButton("重试", (dialog, which) -> webView.reload())
                            .show();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                // 同一域名内的链接在 WebView 内打开
                if (url.startsWith(serverUrl)) {
                    return false;
                }
                // 外部链接也在 WebView 内打开
                view.loadUrl(url);
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient());
    }

    private void setupSwipeRefresh() {
        swipeRefresh.setColorSchemeResources(
                android.R.color.holo_blue_bright,
                android.R.color.holo_green_light,
                android.R.color.holo_orange_light,
                android.R.color.holo_red_light
        );

        swipeRefresh.setOnRefreshListener(() -> {
            webView.reload();
        });
    }

    private void showUrlDialog(boolean isFirstTime) {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("设置服务器地址");

        final EditText input = new EditText(this);
        input.setText(serverUrl);
        input.setHint("例如：http://192.168.1.100:3000");
        input.setSelectAllOnFocus(true);

        LinearLayout layout = new LinearLayout(this);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(48, 24, 48, 0);
        input.setLayoutParams(params);
        layout.addView(input);
        builder.setView(layout);

        builder.setMessage("请输入聊天室服务器地址\n\n提示：\n• 本地调试用电脑IP:3000\n• 服务器部署用域名或公网IP\n• 已部署的服务器用 https://域名");

        builder.setPositiveButton("连接", (dialog, which) -> {
            String url = input.getText().toString().trim();
            if (url.isEmpty()) {
                Toast.makeText(this, "请输入地址", Toast.LENGTH_SHORT).show();
                showUrlDialog(isFirstTime);
                return;
            }
            // 自动补全 http://
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "http://" + url;
            }
            // 去除末尾斜杠
            if (url.endsWith("/")) {
                url = url.substring(0, url.length() - 1);
            }
            serverUrl = url;
            // 保存到本地
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_URL, url).apply();

            webView.loadUrl(serverUrl);
        });

        if (!isFirstTime) {
            builder.setNegativeButton("取消", (dialog, which) -> {
                if (webView.getUrl() == null) {
                    finish();
                }
            });
        }

        builder.setCancelable(false);
        builder.show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK && webView.canGoBack()) {
            webView.goBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
