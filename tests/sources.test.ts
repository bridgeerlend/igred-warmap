import { describe, expect, it } from 'vitest';
import { parseChannelPage } from '../src/core/sources/telegram/index.js';
import { PlaceTagger } from '../src/core/classify/places.js';

/**
 * The deterministic parts of the newer sources. The network calls are exercised against the
 * live services during development; what is pinned here is the parsing and tagging, where a
 * silent regression would put wrong information on the map.
 */

describe('telegram preview parsing', () => {
  const page = `
    <div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="somechannel/101">
        <a class="tgme_widget_message_owner_name"><span>Some Channel</span></a>
        <div class="tgme_widget_message_text js-message_text">Shelling reported near the<br>southern crossing</div>
        <time class="time" datetime="2026-08-03T07:15:00+00:00"></time>
      </div>
    </div>
    <div class="tgme_widget_message_wrap">
      <div class="tgme_widget_message" data-post="somechannel/102">
        <a class="tgme_widget_message_owner_name"><span>Some Channel</span></a>
        <div class="tgme_widget_message_text js-message_text">Second <b>update</b></div>
        <time class="time" datetime="2026-08-03T08:00:00+00:00"></time>
      </div>
    </div>`;

  it('reads each message with its own link and time', () => {
    const posts = parseChannelPage(page, 'somechannel');
    expect(posts).toHaveLength(2);
    expect(posts[0]?.url).toBe('https://t.me/somechannel/101');
    expect(posts[0]?.postedAt).toBe('2026-08-03T07:15:00.000Z');
    expect(posts[1]?.url).toBe('https://t.me/somechannel/102');
  });

  it('keeps line breaks as spaces rather than joining words', () => {
    expect(parseChannelPage(page, 'somechannel')[0]?.text).toBe('Shelling reported near the southern crossing');
  });

  it('strips inline markup out of the text', () => {
    expect(parseChannelPage(page, 'somechannel')[1]?.text).toBe('Second update');
  });

  it('returns nothing for a channel without a public preview', () => {
    // Telegram serves a short placeholder page rather than an error, so an empty result is
    // the signal — the caller reports it as "preview not enabled", not as a crash.
    expect(parseChannelPage('<html><body>Please use Telegram to view this post</body></html>', 'x')).toHaveLength(0);
  });
});

describe('place tagging', () => {
  const tagger = new PlaceTagger({ UP: 'Ukraine', SU: 'Sudan', NI: 'Nigeria', NG: 'Niger' });

  it('tags a country named in the headline', () => {
    expect(tagger.tag([{ title: 'Sudan army drone strike kills 35 in Darfur' }])).toEqual([
      { fips: 'SU', name: 'Sudan' },
    ]);
  });

  it('ranks a headline mention above one buried in the summary', () => {
    const tags = tagger.tag([
      { title: 'Ukraine reports strikes overnight', summary: 'Officials in Sudan also commented.' },
    ]);
    expect(tags[0]?.fips).toBe('UP');
  });

  it('does not match a country name inside a longer word', () => {
    expect(tagger.tag([{ title: 'Nigerien forces and Nigeriana Corp announce a deal' }])).toEqual([]);
  });

  it('keeps Niger and Nigeria apart', () => {
    // One letter apart, and getting it wrong moves a story to another country.
    expect(tagger.tag([{ title: 'Nigeria central bank raises rates' }])).toEqual([
      { fips: 'NI', name: 'Nigeria' },
    ]);
  });

  it('skips names that are ordinary words or common personal names', () => {
    // Georgia, Jordan, Chad and Turkey are all far more common in English as something else.
    const ambiguous = new PlaceTagger({ GG: 'Georgia', JO: 'Jordan', CD: 'Chad', TU: 'Turkey' });
    expect(ambiguous.tag([{ title: 'Jordan and Chad meet in Georgia to discuss Turkey' }])).toEqual([]);
  });

  it('returns nothing rather than guessing when no country is named', () => {
    expect(tagger.tag([{ title: 'Central bank holds interest rates steady' }])).toEqual([]);
  });
});
