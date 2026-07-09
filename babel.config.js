module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated 4 (SDK 54) moved its Babel plugin into react-native-worklets;
    // must stay LAST in the plugin list.
    plugins: ["react-native-worklets/plugin"],
  };
};
