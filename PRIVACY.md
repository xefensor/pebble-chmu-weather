# Privacy

ČHMÚ Weather has no advertisements, analytics or server operated by its
developer, and does not ask you to sign in. It reads weather locations and unit
preferences from Pebble. The current-location entry requests an approximate
phone position with Location permission; fixed saved locations do not request
GPS.

## Requests to weather providers

Nearest forecast towns and stations are selected locally from a bundled
catalogue. Public ČHMÚ graph requests identify a forecast-town ID or station ID
rather than sending the phone's raw GPS coordinates.

Two independent settings are enabled by default:

- **Use ČHMÚ app data** requests three-day local aggregates and clear-sky noon
  UV from the service used by the official ČHMÚ app. Requests use the public
  coordinates of the selected forecast town. The plugin creates a persistent
  random installation ID and obtains its own login and refresh credentials.
  These identify this plugin installation; they are not your Android ID,
  account credentials or credentials copied from another app installation.
- **Use Open-Meteo to complete missing weather data** requests UV fallback,
  precipitation probabilities and forecast data up to seven days. It sends the
  public coordinates of the selected nearby forecast town, not the phone's raw
  GPS position or your saved location name.

ČHMÚ station measurements and valid public ALADIN fields remain the primary
sources for current temperature and hourly forecasts. The app service receives
no request for the phone's actual Android identifier.

The plugin uses these network domains:

| Domain | Purpose |
| --- | --- |
| `data-provider.chmi.cz` | Public ČHMÚ live station and ALADIN forecast graphs |
| `opendata.chmi.cz` | Backup ČHMÚ station observations |
| `chmu.rails.cz` | ČHMÚ app installation authentication, local daily aggregates and clear-sky noon UV |
| `api.open-meteo.com` | Optional additional forecast fields and extended days |

Pebble asks for the plugin's declared network permissions through its normal
permission flow. Installing or upgrading this version may require approval for
`chmu.rails.cz`.

Each provider can observe the connecting network's IP address and the requested
town, station or forecast coordinates, as with other web requests. The ČHMÚ
app service can associate its requests with the random installation ID and
service session. No weather requests, credentials or location data are sent to
the developer. Provider policies: [ČHMÚ](https://www.chmi.cz/) and
[Open-Meteo](https://open-meteo.com/en/terms#privacy).

Turning either source setting off stops future weather updates from contacting
that source and excludes its cached weather values from plugin output. This
includes app-service login and refresh requests for future updates. The
settings are independent, so ČHMÚ app UV can still work with Open-Meteo off.
Disabling a source does not
revoke copies of weather previously delivered to Pebble or watchfaces, which
manage their own storage. A request already sent can finish. Disabling ČHMÚ
app data prevents its later authentication or weather requests from starting
and discards weather returned by an obsolete update.

## Local storage and calculations

Weather responses, station choices, both source settings and the latest
diagnostic per location are stored locally in Pebble's plugin storage. When
ČHMÚ app data is used, the random installation ID is also stored locally so
future requests can reuse the same installation. Service credentials use
Pebble's secure storage when available, with local plugin storage as a fallback
on older runtimes that do not provide it.

The public ČHMÚ/Open-Meteo resource cache retains at most 16 records, and the
ČHMÚ app cache retains at most another 16. These records include station/town
IDs and may include coarse forecast-town or model-grid coordinates and other
provider response metadata. They are not a raw GPS history and are not uploaded
to the developer. Diagnostics contain the place and station names,
measurement time, displayed weather, source information and the original UV
update time. They do not display service credentials.

Feels-like temperature and sunrise/sunset are calculated inside the plugin.
Those calculations do not contact an additional service. Removing the plugin
removes its data according to the Pebble app's storage behavior.

If Location or network access is denied, the plugin may be unable to provide
weather. It never circumvents a denied location-source permission by requesting
GPS instead. Pebble's own provider integration or a consuming watchface may
retain its own cached weather or choose a fallback independently.
