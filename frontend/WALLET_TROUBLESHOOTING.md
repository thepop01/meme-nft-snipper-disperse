# Wallet Connection Troubleshooting

## Using Rabby Wallet When MetaMask is Also Installed

When you have both Rabby and MetaMask installed, they can conflict because both try to inject into `window.ethereum`. Here's how to fix this:

### Method 1: Disable MetaMask Temporarily
1. Go to your browser extensions (chrome://extensions/ or about:addons)
2. Find MetaMask and toggle it OFF
3. Refresh the app page
4. Connect with Rabby
5. You can re-enable MetaMask later, but Rabby should stay connected

### Method 2: Set Rabby as Default Wallet
1. Open Rabby wallet extension
2. Go to Settings → Advanced
3. Look for "Set as Default Wallet" or "Override other wallets"
4. Enable this option
5. Refresh the app page

### Method 3: Use Browser Console to Force Rabby
Open Developer Console (F12) and run:
```javascript
// Check what wallets are detected
console.log('MetaMask:', window.ethereum?.isMetaMask);
console.log('Rabby:', window.ethereum?.isRabby);
console.log('Providers:', window.ethereum?.providers);
```

### Method 4: Use Different Browser Profiles
- Install Rabby in one browser profile
- Install MetaMask in another browser profile
- Use the profile with only Rabby for this app

### How to Switch Between Wallets Without Disconnecting
1. Click "Disconnect" button in the app
2. Click "Connect Wallet" 
3. Select your desired wallet from the dropdown

### Debug Mode
Open console (F12) and you'll see logs like:
- `Detected wallets: [...]` - Shows all wallets found
- `Attempting to connect wallet: Rabby` - When connecting
- `Successfully connected to Rabby` - On success

## Common Issues

**Issue**: "Switch Account" always opens MetaMask
**Fix**: Disconnect first, then reconnect with Rabby selected

**Issue**: Old wallet logs in automatically
**Fix**: The app remembers your last wallet. Click Disconnect, clear browser cache, then reconnect

**Issue**: Rabby not showing in dropdown
**Fix**: Make sure Rabby is properly installed and refresh the page. Check console for detection logs.
