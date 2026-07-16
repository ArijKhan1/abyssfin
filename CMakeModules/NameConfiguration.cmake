set(MAIN_TARGET Abyssfin)

# Output binary name
set(MAIN_NAME abyssfin)

# Data directory name - also used for QCoreApplication::applicationName
# which determines QStandardPaths (cache, config, data dirs)
set(DATA_NAME abyssfin)

if(APPLE)
  set(MAIN_NAME "Abyssfin")
  set(DATA_NAME "Abyssfin")
elseif(WIN32)
  set(MAIN_NAME "Abyssfin")
  set(DATA_NAME "Abyssfin")
endif()

configure_file(src/shared/Names.cpp.in src/shared/Names.cpp @ONLY)
