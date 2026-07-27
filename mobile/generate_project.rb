#!/usr/bin/env ruby
# Generates the checked-in Xcode project without requiring XcodeGen.
require 'xcodeproj'
require 'fileutils'

root = File.expand_path(__dir__)
project_path = File.join(root, 'Dictalume.xcodeproj')
FileUtils.rm_rf(project_path)
project = Xcodeproj::Project.new(project_path)

app = project.new_target(:application, 'Dictalume', :ios, '17.0')
keyboard = project.new_target(:app_extension, 'DictalumeKeyboard', :ios, '17.0')

def configure(target, bundle_id, info, entitlements)
  target.build_configurations.each do |config|
    config.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = bundle_id
    config.build_settings['INFOPLIST_FILE'] = info
    config.build_settings['CODE_SIGN_ENTITLEMENTS'] = entitlements
    config.build_settings['CODE_SIGN_STYLE'] = 'Automatic'
    config.build_settings['SWIFT_VERSION'] = '5.0'
    config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
    config.build_settings['TARGETED_DEVICE_FAMILY'] = '1'
  end
end

configure(
  app,
  'com.dictalume.app',
  'Dictalume/Info.plist',
  'Dictalume/Dictalume.entitlements'
)
configure(
  keyboard,
  'com.dictalume.app.keyboard',
  'DictalumeKeyboard/Info.plist',
  'DictalumeKeyboard/DictalumeKeyboard.entitlements'
)

app_group = project.main_group.new_group('Dictalume', 'Dictalume')
app_sources = Dir[File.join(root, 'Dictalume', '*.swift')].sort.map do |path|
  app_group.new_file(File.basename(path))
end
app_group.new_file('Info.plist')
app_group.new_file('Dictalume.entitlements')
app.add_file_references(app_sources)

keyboard_group = project.main_group.new_group('DictalumeKeyboard', 'DictalumeKeyboard')
keyboard_sources = Dir[File.join(root, 'DictalumeKeyboard', '*.swift')].sort.map do |path|
  keyboard_group.new_file(File.basename(path))
end
keyboard_group.new_file('Info.plist')
keyboard_group.new_file('DictalumeKeyboard.entitlements')
keyboard.add_file_references(keyboard_sources)

app.add_dependency(keyboard)
embed = app.new_copy_files_build_phase('Embed App Extensions')
embed.dst_subfolder_spec = '13'
embed.add_file_reference(keyboard.product_reference, true)

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app)
scheme.add_build_target(keyboard)
scheme.set_launch_target(app)
scheme.save_as(project_path, 'Dictalume', true)

puts "Generated #{project_path}"
