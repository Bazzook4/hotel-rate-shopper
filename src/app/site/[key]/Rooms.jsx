/** One room type: photos, a line about it, what is in it. Shared by Home (a few) and Rooms (all). */
export function RoomCard({ room }) {
  return (
    <article className="site-card">
      {room.photos[0] ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img className="pic" src={room.photos[0]} alt={room.name} loading="lazy" />
      ) : (
        <div className="pic" aria-hidden="true" />
      )}
      <div className="body">
        <h3>{room.name}</h3>
        {room.description && <p className="site-muted">{room.description.length > 140 ? `${room.description.slice(0, 140)}...` : room.description}</p>}
      </div>
    </article>
  );
}
