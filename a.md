newAvailablePeriod

rxPlayer.addEventListener("newAvailablePeriod", per => {
  setAudioTrackForPeriod(per);
  setVideoTrackForPeriod(per);
  setTextTrackForPeriod(per);
});

const periods = rxPlayer.getAvailablePeriods();
periods.forEach(per => {
  setAudioTrackForPeriod(per);
  setVideoTrackForPeriod(per);
  setTextTrackForPeriod(per);
});

function setAudioTrackForPeriod(per) {
  const audioTracks = rxPlayer.getAvailableAudioTracks(per.id);
  if (audioTracks.length > 0) {
    const choosenAudioTrack = module.chooseAudioTrack(audioTracks);
    rxPlayer.setAudioTrack(per.id, choosenAudioTrack);
  }
}
